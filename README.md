# CommuteCapture

CommuteCapture is a hands-free, in-car speech data collection platform for AI/ML training datasets. It allows users to read prompts or perform speech tasks hands-free while driving, capturing audio and contextual metadata (GPS, motion). 

## Features
- Fully hands-free auto-loop recording
- Prompts spoken aloud via TTS
- Automatic audio uploads and metadata capture
- Mobile PWA optimized interface (dark mode, large touch targets)
- Data visualization and dataset coverage tracking

## Ubuntu Deployment Guide

This application is fully containerized and easy to deploy on any Ubuntu server using Docker and Docker Compose.

### Prerequisites

Ensure your Ubuntu machine has Docker and Docker Compose installed.

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Docker
sudo apt install -y docker.io docker-compose-v2

# Start and enable Docker
sudo systemctl enable docker
sudo systemctl start docker

# Add your user to the docker group (optional, requires a logout/login)
sudo usermod -aG docker $USER
```

### Installation & Deployment

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd commute-capture
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory (or use the existing one) with the following minimum required variables.
   
   Ensure that `MINIO_PUBLIC_ENDPOINT` correctly points to the server's public IP or domain name so the browser can directly upload to MinIO. If deploying locally or exclusively matching port mappings, you can use `http://<YOUR_UBUNTU_IP>:9002`.

   ```env
   # API Keys (Provide your own provider keys for TTS/STT)
   OPENAI_API_KEY=your_openai_api_key
   PLAYHT_SECRET_KEY=your_playht_key
   PLAYHT_USER_ID=your_playht_user

   # MinIO settings
   # Replace the IP with your exact Ubuntu Server IP or a Domain Name
   MINIO_PUBLIC_ENDPOINT=http://<YOUR_UBUNTU_IP>:9002
   ```

3. **Start the Stack:**
   Deploy the PostgreSQL database, MinIO object storage, MinIO setup script, and the Node.js application.

   ```bash
   sudo docker compose up -d --build
   ```

4. **Verify Deployment:**
   - The web application will be running on port `3000`: `http://<YOUR_UBUNTU_IP>:3000`
   - MinIO Object Storage API is mapped to port `9002`
   - MinIO Admin Console is mapped to port `9003` (Login: `minioadmin` / `minioadmin`)

### Connecting from Mobile Devices

To securely test the application from a mobile device (like an iPhone PWA), the application must be served over HTTPS unless it is accessed directly via `localhost` or a private IP. You can easily set up HTTPS using a reverse proxy such as Nginx combined with Let's Encrypt (Certbot), or by using an Ngrok tunnel for rapid testing.

#### Quick reverse proxy setup (Caddy):
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Edit /etc/caddy/Caddyfile to point your domain to localhost:3000
```

### Database Backups (Optional)
To export your PostgreSQL data:
```bash
sudo docker exec commute-capture-db-1 pg_dump -U postgres commute_capture > backup.sql
```

To backup the uploaded audio files, grab the `/var/lib/docker/volumes/commute-capture_miniodata` volume contents, or use the `mc` (MinIO Client) tool.
