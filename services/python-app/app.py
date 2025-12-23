from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import mysql.connector
import requests
import os
import uvicorn
import json

app = FastAPI()

# Enable CORS (added as per step 7 in the user request)
origins = [
    "*", # For demo purposes, allowing all. 
    # In production, use specific origins like "https://your-main-website.com"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environment variables for configuration
MYSQL_HOST = os.getenv("MYSQL_HOST", "db")
MYSQL_USER = os.getenv("MYSQL_USER", "user")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "password")
MYSQL_DB = os.getenv("MYSQL_DB", "mydatabase")
GO_WORKER_URL = os.getenv("GO_WORKER_URL", "http://go-worker:8080/process")

def get_mysql_connection():
    try:
        conn = mysql.connector.connect(
            host=MYSQL_HOST,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DB
        )
        return conn
    except mysql.connector.Error as err:
        print(f"Error connecting to MySQL: {err}")
        raise

@app.on_event("startup")
async def startup_event():
    import time
    print("Attempting to connect to MySQL and initialize data...")
    conn = None
    max_retries = 10
    retry_delay = 5
    
    for i in range(max_retries):
        try:
            conn = get_mysql_connection()
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS items (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    value VARCHAR(255)
                )
            """)
            # Check if table is empty, then insert initial data
            cursor.execute("SELECT COUNT(*) FROM items")
            if cursor.fetchone()[0] == 0:
                print("Inserting initial data into 'items' table.")
                cursor.execute("INSERT INTO items (name, value) VALUES ('example_item_1', 'initial_value_A')")
                cursor.execute("INSERT INTO items (name, value) VALUES ('example_item_2', 'initial_value_B')")
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

@app.get("/process-data")
async def process_data():
    conn = None
    try:
        # 1. Get data from MySQL
        conn = get_mysql_connection()
        cursor = conn.cursor(dictionary=True) # Return rows as dictionaries
        cursor.execute("SELECT id, name, value FROM items LIMIT 1")
        item_data = cursor.fetchone()

        if not item_data:
            raise HTTPException(status_code=404, detail="No data found in MySQL")

        print(f"Fetched from MySQL: {item_data}")

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
            "mysql_item_id": item_data["id"],
            "mysql_item_name": item_data["name"],
            "original_value": item_data["value"],
            "go_processed_data": go_result.get("processed_data"),
            "go_worker_id": go_result.get("worker_id"),
            "timestamp": go_result.get("timestamp") # Assuming Go worker might add this
        }
        return final_result

    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Could not connect to Go worker: {e}")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Error from Go worker: {e}")
    except mysql.connector.Error as e:
        raise HTTPException(status_code=500, detail=f"MySQL error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
