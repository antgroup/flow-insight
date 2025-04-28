from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import json
import os
import uvicorn
from typing import Optional
from pathlib import Path

app = FastAPI(title="Flow Insight API")

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
async def get_call_graph(flow_id: Optional[str] = None, stack_mode: Optional[str] = None):
    if stack_mode == 'true' or stack_mode == '1':
        # Return the contents of dstack.json
        return load_json_file('dstack.json')
    else:
        # Return the contents of call_graph.json
        return load_json_file('graphdata.json')

@app.get('/physical_view')
async def get_physical_view(flow_id: Optional[str] = None):
    # Return the contents of physical.json
    return load_json_file('physical.json')

@app.get('/flame_graph')
async def get_flame_graph(flow_id: Optional[str] = None):
    # Return the contents of flame.json
    return load_json_file('flame.json')

# Get the absolute path to the dist directory
current_dir = os.path.dirname(os.path.abspath(__file__))
frontend_dir = os.path.join(os.path.dirname(current_dir), "dist")

# Check if the dist directory exists
if not os.path.exists(frontend_dir):
    print(f"Warning: Frontend directory not found at {frontend_dir}")

# Serve static files from the assets directory
app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="assets")

# Serve the favicon.svg
@app.get("/favicon.svg")
async def favicon():
    return FileResponse(os.path.join(frontend_dir, "favicon.svg"))

# Catch-all route to serve index.html for any path
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    index_path = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "Page not found"}

if __name__ == "__main__":
    uvicorn.run("fastapi_server:app", host="0.0.0.0", port=8001, reload=True)