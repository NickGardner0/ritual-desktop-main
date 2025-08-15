# Postman Setup for Ritual API

## Quick Start

### 1. Install Postman
- Download from [postman.com](https://www.postman.com/downloads/)
- Create a free account (optional but recommended)

### 2. Import the Collection
1. Open Postman
2. Click "Import" button
3. Select the `ritual-api-postman-collection.json` file
4. The collection will appear in your workspace

### 3. Import the Environment
1. Click "Import" again
2. Select the `ritual-api-postman-environment.json` file
3. Select the "Ritual API - Development" environment from the dropdown

### 4. Configure Your Credentials
1. Click the environment dropdown (top right)
2. Select "Ritual API - Development"
3. Click the eye icon to edit variables
4. Update:
   - `user_email`: Your actual email
   - `user_password`: Your actual password
   - `base_url`: Should be `http://localhost:8000` (default)

## Testing Your API

### 1. Health Check
- Run the "Health Check" request first
- Should return: `{"message": "Ritual API is running"}`

### 2. Authentication
- Run the "Login" request under Authentication
- Copy the `access_token` from the response
- Paste it into the `auth_token` environment variable

### 3. Test Other Endpoints
- All other requests will now use the auth token automatically
- Start with "Get All Habits" or "Get Current User"

## Key Features

### Environment Variables
- `{{base_url}}`: Automatically used in all requests
- `{{auth_token}}`: Automatically added to Authorization header
- `{{user_email}}` & `{{user_password}}`: For login requests

### Pre-request Scripts (Optional)
You can add this to the Login request to automatically set the auth token:

```javascript
// Add to Login request Pre-request Script tab
pm.test("Login successful", function () {
    pm.response.to.have.status(200);
    var jsonData = pm.response.json();
    pm.environment.set("auth_token", jsonData.access_token);
});
```

### Test Scripts (Optional)
Add validation to your requests:

```javascript
// Example test script for habits endpoint
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has habits array", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('habits');
});
```

## API Endpoints Overview

### Authentication
- `POST /auth/token` - Login with email/password

### Users
- `GET /users/me` - Get current user
- `POST /users/` - Create new user
- `PUT /users/me` - Update current user

### Habits
- `GET /habits/` - Get all habits
- `POST /habits/` - Create new habit
- `GET /habits/{id}` - Get specific habit
- `PUT /habits/{id}` - Update habit
- `DELETE /habits/{id}` - Delete habit

### Habit Logs
- `GET /habit-logs/` - Get all logs
- `POST /habit-logs/` - Create new log
- `GET /habit-logs/habit/{id}` - Get logs for specific habit

### Other Endpoints
- `GET /predefined-habits/` - Get predefined habits
- `GET /habit-units/` - Get available units
- `GET /subscriptions/me` - Get user subscription
- `GET /habit-data/` - Get integrations
- `POST /habit-data/` - Connect integration

## Tips for Development

1. **Use the Collection Runner** for testing multiple endpoints
2. **Save responses** to compare before/after changes
3. **Use the Console** (View → Show Postman Console) for debugging
4. **Export your collection** regularly to backup your work
5. **Use different environments** for dev/staging/prod

## Troubleshooting

### Common Issues
- **401 Unauthorized**: Check your auth token is set correctly
- **404 Not Found**: Verify the endpoint exists in your FastAPI app
- **500 Server Error**: Check your backend logs

### FastAPI Integration
- Your FastAPI app automatically generates OpenAPI docs at `http://localhost:8000/docs`
- You can import these docs directly into Postman for even more complete coverage 