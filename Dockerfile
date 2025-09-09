FROM python:3.10-slim

# install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    unixodbc-dev \
    && rm -rf /var/lib/apt/lists/*

# set work directory
WORKDIR /app

# install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy project
COPY . .

EXPOSE 8000

# run server
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
