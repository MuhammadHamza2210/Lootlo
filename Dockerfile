# Docker recipe to run the LootLo Flask app on Hugging Face Spaces (free, no card).
# Hugging Face serves apps on port 7860 and requires a non-root user (UID 1000).
FROM python:3.12-slim

# Create the required non-root user (UID 1000)
RUN useradd -m -u 1000 user

# Install dependencies as root so they land on the system PATH (gunicorn etc.)
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Run as the non-root user with a writable home (the SQLite DB is created here)
USER user
ENV HOME=/home/user
WORKDIR /home/user/app

# Copy the app, owned by the runtime user so it can create lootlo.db
COPY --chown=user . .

ENV PORT=7860
EXPOSE 7860

# gunicorn serves the Flask "app" object from app.py on Hugging Face's port
# --preload imports the app once in the master (so init_db runs a single time
# before workers fork), avoiding a multi-worker race on database seeding.
CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--workers", "2", "--preload", "--timeout", "120", "app:app"]
