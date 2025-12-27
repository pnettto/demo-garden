# Natural Chart Creator

## Features
- Ask questions about your data in plain English
- Supports CSV files (e.g., employees, products, spending)
- Easy-to-use web interface powered by Streamlit
- No coding required for end users

## How to Use
1. **Prepare your data:** Place your CSV files in the `files/` directory. Example files are provided.
2. **Start the app:**
   - Make sure you have Python installed.
   - (Optional) Create and activate a virtual environment.
   - Install required packages: `pip install -r requirements.txt`
   - Run the app: `streamlit run streamlit_app.py`
3. **Open your browser:** The app will open automatically or provide a local URL. Use the interface to ask questions about your data.

## Example Questions
- "How much did we spend in March 2023?"
- "List all employees hired after 2021."
- "What are the top 5 products by sales?"

Obs.: The question need to be related to the existing data files in the `/files` directory.