import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=8002,
        reload=False,
        timeout_keep_alive=5,
        limit_concurrency=10,
    )
