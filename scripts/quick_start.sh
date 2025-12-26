
export GIT_PAT="??? get this here: https://github.com/settings/personal-access-tokens"

mkdir -p ~/demos
cd ~/demos

if [ ! -d ".git" ]; then
  git clone https://$GIT_PAT@github.com/pnettto/demos .
else
  git pull origin main
fi

docker compose --profile '*' down --remove-orphans && docker compose up -d --build --remove-orphans
