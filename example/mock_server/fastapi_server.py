from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import os
import uvicorn
from typing import Optional

app = FastAPI(title="Flow Insight API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Load JSON data files
def load_json_file(filename):
    current_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(current_dir, filename)
    try:
        with open(file_path, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: {filename} not found at {file_path}")
        return {"result": False, "msg": f"File {filename} not found", "data": {}}

# API endpoints
@app.get('/call_graph')
async def get_call_graph(job_id: Optional[str] = None, stack_mode: Optional[str] = None):
    if stack_mode == 'true' or stack_mode == '1':
        # Return the contents of dstack.json
        return load_json_file('dstack.json')
    else:
        # Return the contents of call_graph.json
        return load_json_file('graphdata.json')

@app.get('/physical_view')
async def get_physical_view(job_id: Optional[str] = None):
    # Return the contents of physical.json
    return load_json_file('physical.json')

@app.get('/flame_graph')
async def get_flame_graph(job_id: Optional[str] = None):
    # Return the contents of flame.json
    return load_json_file('flame.json')

# A simple health check endpoint
@app.get('/')
async def health_check():
    return {
        "result": True,
        "msg": "API server is running",
        "data": {
            "endpoints": [
                "/call_graph",
                "/physical_view",
                "/flame_graph"
            ]
        }
    }