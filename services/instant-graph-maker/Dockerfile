FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .
COPY .streamlit/ ./.streamlit

EXPOSE 8000
HEALTHCHECK CMD curl --fail http://instant-graph-maker:8000/_stcore/health
ENTRYPOINT ["python3", "-m", "streamlit", "run", "streamlit_app.py", \
    "--server.port=8000", \
    "--server.address=0.0.0.0"]