# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import all_routers

app = FastAPI(
    title="Ritual API",
    version="1.0.0",
    description="A self-tracking and habit management API"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router, prefix in all_routers:
    app.include_router(router, prefix=prefix)

@app.get("/")
def read_root():
    return {"message": "Ritual API is running"}
