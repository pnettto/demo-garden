#!/bin/bash

# --- 1. CONFIGURATION ---
echo "=== Full GCP & GitHub Actions Automator ==="

# Auto-detect Project and Repo
CURRENT_PROJECT=$(gcloud config get-value project)
CURRENT_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)

read -p "Enter GCP Project ID [$CURRENT_PROJECT]: " PROJECT_ID
PROJECT_ID=${PROJECT_ID:-$CURRENT_PROJECT}

read -p "Enter GitHub Repo (e.g., username/repo) [$CURRENT_REPO]: " GH_REPO
GH_REPO=${GH_REPO:-$CURRENT_REPO}

read -p "Enter the domain for SSL (e.g., demos.pnetto.com): " DOMAIN
read -p "Enter GCP Zone [us-central1-a]: " ZONE
ZONE=${ZONE:-"us-central1-a"}
REGION="${ZONE%-*}"
INSTANCE_NAME="demos-vm"

# --- 2. INFRASTRUCTURE SETUP ---
echo -e "\n--- Step 1: Reserving Static IP (Standard Tier) ---"
gcloud compute addresses create "${INSTANCE_NAME}-ip" \
    --region="$REGION" --project="$PROJECT_ID" --network-tier=STANDARD --quiet 2>/dev/null || echo "Using existing IP."

STATIC_IP=$(gcloud compute addresses describe "${INSTANCE_NAME}-ip" \
    --region="$REGION" --project="$PROJECT_ID" --format="get(address)" | xargs)

# --- 3. DEFENSIVE DNS CHECK ---
echo -e "\n--- Step 2: DNS Verification ---"
echo "Point A-Record for $DOMAIN to: $STATIC_IP"
while true; do
    RESOLVED_IP=$(dig @8.8.8.8 +short "$DOMAIN" | tail -n1 | sed 's/\.$//' | xargs)
    if [[ -n "$STATIC_IP" && "$RESOLVED_IP" == "$STATIC_IP" ]]; then
        echo "Success! DNS matches."
        break
    else
        echo "[WAIT] DNS: '${RESOLVED_IP:-NONE}' | Expected: $STATIC_IP"
        read -p "Options: [r]etry, [f]orce, [q]uit: " choice
        case $choice in [fF]*) break;; [qQ]*) exit 1;; *) sleep 15;; esac
    fi
done

# --- 4. SSH KEY & GITHUB SECRETS ---
echo -e "\n--- Step 3: Configuring GitHub Secrets via 'gh' CLI ---"
SSH_KEY_FILE="./id_rsa_deploy"
if [ ! -f "$SSH_KEY_FILE" ]; then
    ssh-keygen -t rsa -b 4096 -f "$SSH_KEY_FILE" -N "" -C "github-actions-deploy"
fi

# Set secrets in GitHub
gh secret set VM_IP --body "$STATIC_IP" --repo "$GH_REPO"
gh secret set VM_USER --body "deploy-user" --repo "$GH_REPO"
gh secret set SSH_PRIVATE_KEY --body "$(cat $SSH_KEY_FILE)" --repo "$GH_REPO"
gh secret set VM_PASSPHRASE --body "" --repo "$GH_REPO"

# Request a temporary PAT for the VM to clone the repo (or use a secret you already have)
read -p "Enter GH_PAT (for VM to clone repo): " GH_PAT
gh secret set GH_PAT --body "$GH_PAT" --repo "$GH_REPO"

# --- 5. STARTUP SCRIPT GENERATION ---
cat << EOF > startup-script.sh
#!/bin/bash
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y ca-certificates curl gnupg dnsutils git
# Install Docker & gVisor
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \$(. /etc/os-release && echo "\$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list
curl -fsSL https://gvisor.dev/archive.key -o /etc/apt/keyrings/gvisor.asc
echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/gvisor.asc] https://storage.googleapis.com/gvisor/releases release main" | tee /etc/apt/sources.list.d/gvisor.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin runsc
runsc install && systemctl restart docker

# Swap
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Setup User & Key
useradd -m -s /bin/bash deploy-user
usermod -aG docker deploy-user
mkdir -p /home/deploy-user/.ssh
echo "$(cat ${SSH_KEY_FILE}.pub)" > /home/deploy-user/.ssh/authorized_keys
chown -R deploy-user:deploy-user /home/deploy-user/.ssh
chmod 700 /home/deploy-user/.ssh
chmod 600 /home/deploy-user/.ssh/authorized_keys

# Initial Clone as deploy-user
sudo -u deploy-user bash -c "mkdir -p ~/demos && cd ~/demos && git clone https://$GH_PAT@github.com/$GH_REPO.git ."
EOF

# --- 6. DEPLOY ---
echo -e "\n--- Step 4: Launching VM ---"
gcloud compute instances create "$INSTANCE_NAME" \
    --project="$PROJECT_ID" --zone="$ZONE" --machine-type=e2-micro \
    --network-tier=STANDARD --address="$STATIC_IP" \
    --metadata-from-file=startup-script=startup-script.sh \
    --boot-disk-size=30GB --boot-disk-type=pd-balanced \
    --tags=http-server,https-server --provisioning-model=STANDARD

echo -e "\n=== DEPLOYMENT COMPLETE ==="
echo "1. GitHub Secrets are set."
echo "2. VM is booting and cloning $GH_REPO."
echo "3. You can now push to 'main' to trigger your first GitHub Action deploy."