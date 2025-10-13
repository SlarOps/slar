# API Token Management - Demo Guide

This guide demonstrates how to use the new API Token Management feature in the Integrations page.

## Quick Start

### 1. Navigate to Integrations
```
http://localhost:3000/integrations
```

### 2. Switch to API Tokens Tab
Click on the **API Tokens** tab at the top of the page (icon: 🔑)

### 3. Add Your First Token

**Step-by-step:**
1. Click the **"Add Token"** button (top right)
2. A modal will appear with the following fields:

   **Provider**: Select from dropdown
   - 🔮 Google Gemini
   - 🤖 OpenAI  
   - 🎭 Anthropic Claude
   - 🔧 Other

   **Token Name**: Enter a friendly name
   - Example: "My Development Gemini Key"
   - Example: "Production OpenAI Key"

   **API Token**: Paste your actual API key
   - Will be masked with password input
   - Validated for minimum length

3. Click **"Add Token"** to save

### 4. View Your Token

After adding, you'll see a card displaying:
- Token name
- Provider badge
- Active/Inactive status
- Masked token (with show/hide toggle)
- Copy to clipboard button
- Created and last used dates

### 5. Manage Your Token

Click the three-dot menu (⋮) to:
- **Edit Token**: Modify name or token value
- **Activate/Deactivate**: Toggle the active status
- **Delete Token**: Remove permanently (with confirmation)

## Use Cases

### Using Gemini with AI Terminal

1. **Add Gemini API Key**:
   ```
   Provider: Google Gemini
   Name: Terminal Gemini Key
   Token: AIza...your_key_here
   ```

2. **Key is Auto-Applied**:
   - When you add/edit a Gemini token, it's saved to `sessionStorage`
   - The AI Terminal automatically picks it up on next connection
   - No manual configuration needed!

3. **Open Terminal**:
   - Navigate to AI Agent page
   - Switch to Terminal tab
   - The terminal now has access to Gemini API

4. **Test It**:
   ```bash
   # In the terminal, if you have 'gemini' CLI tool:
   gemini chat "Hello from SLAR!"
   ```

### Multiple Providers

You can store multiple tokens:

```javascript
// Example token list
[
  { name: "Dev Gemini", provider: "gemini", token: "AIza..." },
  { name: "Prod OpenAI", provider: "openai", token: "sk-..." },
  { name: "Claude API", provider: "anthropic", token: "sk-ant..." }
]
```

### Token Status Management

**Active Token**: ✅
- Can be used by the system
- Displayed with green badge

**Inactive Token**: ⚫
- Stored but not used
- Good for rotating keys or temporary disable
- Displayed with gray badge

## Component Features Demo

### APITokenCard Features

**Show/Hide Token**:
```
Masked:  AIza••••••••••••••••••1234
Visible: AIzaSyDxK...actual_full_key
```

**Copy to Clipboard**:
- Click 📋 button
- Shows ✓ when copied
- Automatically resets after 2 seconds

**Provider Colors**:
- Gemini: Purple
- OpenAI: Green
- Anthropic: Orange
- Other: Gray

### TokenModal Features

**Form Validation**:
- Token name required
- Token must be at least 10 characters
- Real-time error display

**Provider-Specific Help**:
When you select Gemini:
```
💡 Get your Gemini API key: Visit Google AI Studio
   [https://aistudio.google.com/app/apikey]
```

**Responsive Design**:
- Works on mobile and desktop
- Smooth animations
- Dark mode support

## Testing the Integration

### Test 1: Add Token
1. Add a Gemini token
2. Check browser DevTools > Application > Session Storage
3. Should see `GEMINI_API_KEY` entry

### Test 2: Terminal Connection
1. Open AI Terminal
2. Check browser console
3. Should see WebSocket message sending env variables

### Test 3: Edit Token
1. Edit an existing token
2. Change the token value
3. Verify sessionStorage updates

### Test 4: Delete Token
1. Delete a token
2. Confirm in modal
3. Verify it's removed from list and localStorage

## Tips & Best Practices

### Security
✅ **Do**:
- Use different tokens for dev/staging/prod
- Rotate tokens regularly
- Deactivate unused tokens

❌ **Don't**:
- Share tokens publicly
- Commit tokens to git
- Use production tokens in development

### Organization
- Use descriptive names: "Production Gemini Key", not "Key1"
- Add creation date in name for rotation tracking
- Use provider prefixes: "GEM-Prod", "OAI-Dev"

### Token Lifecycle
1. **Create**: Add new token with clear name
2. **Use**: Activate and integrate with services
3. **Monitor**: Check last used date
4. **Rotate**: Create new, deactivate old
5. **Clean**: Delete obsolete tokens

## Troubleshooting

### Token Not Working
- ✓ Check token is **Active**
- ✓ Verify token is valid (test in provider's platform)
- ✓ Refresh the page
- ✓ Check browser console for errors

### Terminal Not Getting Key
- ✓ Make sure Gemini token is added
- ✓ Refresh terminal connection
- ✓ Check sessionStorage in DevTools
- ✓ Verify WebSocket connection is open

### Modal Not Opening
- ✓ Check for JavaScript errors
- ✓ Ensure Headless UI is installed
- ✓ Verify Modal component is imported correctly

## API Reference

### localStorage Schema
```javascript
{
  key: "api_tokens",
  value: [
    {
      id: string,           // Unique ID (timestamp)
      name: string,         // Display name
      token: string,        // Actual API key
      provider: string,     // 'gemini', 'openai', 'anthropic', 'other'
      isActive: boolean,    // Active status
      createdAt: string,    // ISO date string
      lastUsed: string|null // ISO date string or null
    }
  ]
}
```

### sessionStorage for Terminal
```javascript
{
  key: "GEMINI_API_KEY",
  value: string // The Gemini API token
}
```

### WebSocket Message Format
```javascript
// Client -> Server (on connection open)
{
  "env": {
    "GEMINI_API_KEY": "actual_api_key_value"
  }
}

// Server processes and sets os.environ["GEMINI_API_KEY"]
```

## Video Demo Script

```
[00:00] Introduction
"Welcome to the API Token Management feature in SLAR."

[00:15] Navigate to Integrations
"Let's navigate to the Integrations page and click on API Tokens tab."

[00:30] Add First Token
"Click Add Token, select Google Gemini as provider..."
"Enter a name like 'My Gemini Key'..."
"Paste your API key from Google AI Studio..."
"And click Add Token."

[01:00] View Token
"Now we can see our token card with provider badge..."
"The token is masked for security..."
"We can show/hide it, or copy to clipboard."

[01:30] Use in Terminal
"Let's open the AI Terminal..."
"The token is automatically sent to the terminal session..."
"Now we can use Gemini-powered features!"

[02:00] Manage Tokens
"We can edit, deactivate, or delete tokens..."
"Perfect for managing multiple API keys securely."

[02:30] Conclusion
"That's it! Easy API token management for your AI integrations."
```

## Next Steps

After mastering the basics:
1. ✅ Set up token rotation schedule
2. ✅ Configure different tokens for different environments
3. ✅ Monitor token usage patterns
4. ✅ Integrate with other AI services (OpenAI, Claude)
5. ✅ Explore advanced terminal features with AI

## Support

For issues or questions:
- Check the [README](./README.md) for technical details
- Review browser console for errors
- Verify API key is valid with provider
- Test WebSocket connection is working

Happy coding! 🚀

