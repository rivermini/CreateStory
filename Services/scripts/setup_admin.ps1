$email = Read-Host "Enter admin email"
if ($email) {
    docker compose exec -it fastapi_gateway python bootstrap_admin.py --email $email
} else {
    Write-Host "Admin email is required."
}
