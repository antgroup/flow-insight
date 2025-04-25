# Mock API Server for Flow Insight

This directory contains mock API servers that provide the endpoints needed by Flow Insight.

## Available Endpoints

- `/call_graph` - Returns graph data
- `/physical_view` - Returns physical view data
- `/flame_graph` - Returns flame graph data

## Flask Server (Original)

The original implementation uses Flask.

### Requirements

```
pip install flask flask-cors
```

### Running the Server

```
python server.py
```

## FastAPI Server (Recommended)

The improved implementation uses FastAPI, which offers better performance, automatic API documentation, and more robust CORS handling.

### Requirements

```
pip install -r requirements.txt
```

### Running the Server

```
python fastapi_server.py
```

### API Documentation

FastAPI automatically generates API documentation. Once the server is running, you can access:

- Swagger UI: http://localhost:5000/docs
- ReDoc: http://localhost:5000/redoc

## Switching Between Servers

Both servers run on port 5000 by default. Make sure to stop one before starting the other. 