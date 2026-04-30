FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHORUS_HOST=0.0.0.0 \
    CHORUS_PORT=8008

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY chorus_python ./chorus_python
COPY scripts/chorus_submit_server.py ./scripts/chorus_submit_server.py
COPY public ./public

EXPOSE 8008

CMD ["python", "scripts/chorus_submit_server.py"]
