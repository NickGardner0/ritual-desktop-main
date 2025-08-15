# Use slim Python image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Define pip cache directory (matches docker-compose volume)
ENV PIP_CACHE_DIR=/root/.cache/pip

# Copy requirements file first to cache dependencies
COPY requirements.txt .

# Install dependencies without writing pyc files or using cache beyond pip_cache volume
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Python runtime environment variables
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Expose the default FastAPI port
EXPOSE 8000

# Default command (will be overridden by docker-compose)
CMD ["python", "run.py"]
