from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import psycopg
from psycopg.rows import dict_row
import requests
import os
import uvicorn
import json
from contextlib import asynccontextmanager

# Environment variables for configuration
DB_HOST = os.getenv("DB_HOST")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")
GO_WORKER_URL = 'http://go-worker:8080/process'

def get_db_connection():
    try:
        conn = psycopg.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            dbname=DB_NAME,
            row_factory=dict_row
        )
        return conn
    except Exception as err:
        print(f"Error connecting to PostgreSQL: {err}")
        raise

@asynccontextmanager
async def lifespan(app: FastAPI):
    import time
    print("Attempting to connect to PostgreSQL and initialize data...")
    conn = None
    max_retries = 15
    retry_delay = 5
    
    for i in range(max_retries):
        try:
            conn = get_db_connection()
            with conn.cursor() as cursor:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS items (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        value VARCHAR(255)
                    )
                """)
                # Check if table is empty, then insert initial data
                cursor.execute("SELECT COUNT(*) FROM items")
                count = cursor.fetchone()["count"]
                if count == 0:
                    print("Inserting initial data into 'items' table.")
                    cursor.execute("INSERT INTO items (name, value) VALUES (%s, %s)", ('example_item_1', 'initial_value_A'))
                    cursor.execute("INSERT INTO items (name, value) VALUES (%s, %s)", ('example_item_2', 'initial_value_B'))
                    conn.commit()
                else:
                    print("Table 'items' already contains data.")
            break
        except Exception as e:
            print(f"Startup attempt {i+1} failed: {e}")
            if i < max_retries - 1:
                print(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
            else:
                print("Max retries reached. Startup failed.")
        finally:
            if conn:
                conn.close()
    yield

app = FastAPI(lifespan=lifespan)

# Enable CORS
origins = [
    "https://demos.pnetto.com",
    "http://localhost",
    "*", # Keeping * for flexibility in this demo environment
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/process-data")
async def process_data():
    conn = None
    try:
        # 1. Get data from PostgreSQL
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT id, name, value FROM items LIMIT 1")
            item_data = cursor.fetchone()

        if not item_data:
            raise HTTPException(status_code=404, detail="No data found in PostgreSQL")

        print(f"Fetched from PostgreSQL: {item_data}")

        # 2. Send to Go worker for parallel task
        go_payload = {"data": item_data["value"]}
        print(f"Sending to Go worker: {go_payload}")
        go_response = requests.post(GO_WORKER_URL, json=go_payload)
        go_response.raise_for_status() # Raise an exception for HTTP errors
        go_result = go_response.json()
        print(f"Received from Go worker: {go_result}")

        # 3. Format and return
        final_result = {
            "source": "python-app",
            "db_item_id": item_data["id"],
            "db_item_name": item_data["name"],
            "original_value": item_data["value"],
            "go_processed_data": go_result.get("processed_data"),
            "go_worker_id": go_result.get("worker_id"),
            "timestamp": go_result.get("timestamp")
        }
        return final_result

    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Could not connect to Go worker: {e}")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Error from Go worker: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
