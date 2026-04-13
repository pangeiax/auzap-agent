FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Sem watchfiles, uvicorn usa StatReload (polling) — evita crash de memória em Docker/Windows.
RUN pip uninstall -y watchfiles 2>/dev/null; true
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-exclude", "venv", "--reload-exclude", "__pycache__"]