FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN echo 'server { listen 8000; location / { root /usr/share/nginx/html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf