#!/bin/bash

# --- 1. INTERACTIVE CONFIGURATION ---
echo "=== GCP e2-micro Environment Builder (Defensive Mode) ==="

CURRENT_PROJECT=$(gcloud config get-value project)
read -p "Enter GCP Project ID [$CURRENT_PROJECT]: " PROJECT_ID
PROJECT_ID=${PROJECT_ID:-$CURRENT_PROJECT}

read -p "Enter the domain for SSL (e.g., demos.pnetto.com): " DOMAIN
read -p "Enter GCP Zone [us-central1-a]: " ZONE
ZONE=${ZONE:-"us-central1-a"}
REGION="${ZONE%-*}"
read -p "Enter Instance Name [demos]: " INSTANCE_NAME
INSTANCE_NAME=${INSTANCE_NAME:-"demos"}

# --- 2. INFRASTRUCTURE SETUP ---
echo -e "\n--- Step 1: Reserving Static IP (Standard Tier) ---"
# Create the IP with the tier
gcloud compute addresses create "${INSTANCE_NAME}-ip" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --network-tier=STANDARD \
    --quiet 2>/dev/null || echo "Using existing IP."

# CORRECTED: Describe does NOT take a tier flag. 
# Added xargs to ensure no hidden whitespace/newlines.
STATIC_IP=$(gcloud compute addresses describe "${INSTANCE_NAME}-ip" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format="get(address)" | xargs)

echo -e "\n--- Step 2: Configuring Firewall ---"
gcloud compute firewall-rules create allow-http-https \
    --allow tcp:80,tcp:443 \
    --target-tags http-server,https-server \
    --project="$PROJECT_ID" --quiet 2>/dev/null || echo "Firewall rules already exist."

# --- 3. DEFENSIVE DNS VERIFICATION ---
echo -e "\n********************************************************"
echo " ACTION REQUIRED: Point your DNS A-Record for $DOMAIN "
echo " to this Static IP: $STATIC_IP"
echo "********************************************************"

while true; do
    # Get IP, remove trailing dot, and trim
    RESOLVED_IP=$(dig @8.8.8.8 +short "$DOMAIN" | tail -n1 | sed 's/\.$//' | xargs)
    
    if [[ -n "$STATIC_IP" && "$RESOLVED_IP" == "$STATIC_IP" ]]; then
        echo -e "\n[MATCH] Success! $DOMAIN points to $STATIC_IP."
        break
    else
        echo -e "\n[WAIT] DNS points to: '${RESOLVED_IP:-NONE}'"
        echo "Expected: $STATIC_IP"
        echo "--------------------------------------------------------"
        echo "Options: [r]etry automatically in 15s, [f]orce proceed, [q]uit"
        read -p "Selection: " choice
        
        case $choice in
            [fF]* ) break;;
            [qQ]* ) echo "Exiting..."; exit 1;;
            * ) echo "Waiting 15 seconds for propagation..."; sleep 15;;
        esac
    fi
done

# --- 4. GENERATE STARTUP SCRIPT ---
cat << EOF > startup-script.sh
#!/bin/bash
export DEBIAN_FRONTEND=noninteractive

# Update and Install Docker/gVisor
apt-get update
apt-get install -y ca-certificates curl gnupg dnsutils
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \$(. /etc/os-release && echo "\$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list
curl -fsSL https://gvisor.dev/archive.key -o /etc/apt/keyrings/gvisor.asc
chmod a+r /etc/apt/keyrings/gvisor.asc
echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/gvisor.asc] https://storage.googleapis.com/gvisor/releases release main" | tee /etc/apt/sources.list.d/gvisor.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin runsc

# Init gVisor and Swap
runsc install
systemctl restart docker
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Aliases
cat << 'AL' > /etc/profile.d/docker_aliases.sh
alias dps='docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"'
alias drs="docker compose --profile '*' down --remove-orphans && docker compose up -d --build --remove-orphans"
AL
EOF

# --- 5. DEPLOY INSTANCE ---
echo -e "\n--- Step 3: Launching VM (Standard Tier) ---"
gcloud compute instances create "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --network-tier=STANDARD \
    --machine-type=e2-micro \
    --image-family=debian-12 \
    --image-project=debian-cloud \
    --address="$STATIC_IP" \
    --metadata-from-file=startup-script=startup-script.sh \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-balanced \
    --tags=http-server,https-server \
    --provisioning-model=STANDARD

echo -e "\n=== DEPLOYMENT INITIATED ==="
echo "Point your terminal to the instance log to watch the setup:"
echo "gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command='sudo tail -f /var/log/daemon.log'"