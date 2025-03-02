# EverArt Forge MCP - LLM Installation Guide

This guide is specifically designed to help LLM agents like Cline install and configure the EverArt Forge MCP server.

## Prerequisites

- Node.js v14+ installed
- Access to an EverArt API key
- Permission to edit MCP configuration files

## Step-by-Step Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/nickbaumann98/everart-forge-mcp.git
   cd everart-forge-mcp
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Configure the MCP server**:

   You'll need to add the server to the appropriate MCP configuration file based on the client:

   **For Cline VS Code Extension**:
   Edit the file at `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` on macOS, or the equivalent path on Windows/Linux.

   **For Claude Desktop**:
   Edit the file at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or the equivalent path on Windows/Linux.

   Add this configuration (update the paths and API key):

   ```json
   {
     "mcpServers": {
       "everart-forge": {
         "command": "node",
         "args": ["/absolute/path/to/everart-forge-mcp/build/index.js"],
         "env": {
           "EVERART_API_KEY": "your_everart_api_key_here"
         },
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

5. **Getting an EverArt API key**:
   - Sign up at [EverArt](https://everart.ai/)
   - Navigate to account settings
   - Create or copy your API key

6. **Verification**:
   After adding the configuration, restart Cline and verify the server is connected by checking the MCP servers section. You can then test the server by asking Cline to generate an image.

## Troubleshooting

- If the server doesn't appear in the MCP list, check if the path to the index.js file is correct and absolute
- If the server appears but shows errors, verify your API key is correct
- If you see "Error: Invalid model ID", ensure you're using a supported model ID (5000, 6000, 7000, 8000, 9000)
- SVG format is only available with the Recraft-Vector (8000) model

## Configuration Options

All server configuration is done through environment variables in the MCP settings file:

| Variable | Description | Required |
|----------|-------------|----------|
| EVERART_API_KEY | Your EverArt API key | Yes |

## Usage Examples

Once configured, the LLM can generate images with:

```
I'll help you generate an image using EverArt Forge MCP.

<use_mcp_tool>
<server_name>github.com/nickbaumann98/everart-forge-mcp</server_name>
<tool_name>generate_image</tool_name>
<arguments>
{
  "prompt": "A minimalist tech logo with clean lines",
  "model": "8000:Recraft-Vector",
  "format": "svg"
}
</arguments>
</use_mcp_tool>
```

For listing existing images:

```
<use_mcp_tool>
<server_name>github.com/nickbaumann98/everart-forge-mcp</server_name>
<tool_name>list_images</tool_name>
<arguments>
{}
</arguments>
</use_mcp_tool>
