# EverArt Forge MCP for Cline

[![smithery badge](https://smithery.ai/badge/@nickbaumann98/everart-forge-mcp)](https://smithery.ai/server/@nickbaumann98/everart-forge-mcp)
![EverArt Forge MCP](icon.svg)

An advanced Model Context Protocol (MCP) server for [Cline](https://github.com/cline/cline) that integrates with EverArt's AI models to generate both vector and raster images. This server provides powerful image generation capabilities with flexible storage options and format conversion.

## Cline Integration

This MCP server is designed to work with Cline, providing AI-powered image generation capabilities directly through your Cline conversations. To use it:

1. Install the server following the instructions below
2. Add it to your Cline MCP settings file (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):
   ```json
   {
     "mcpServers": {
       "everart-forge": {
         "command": "node",
         "args": ["/path/to/everart-forge-mcp/build/index.js"],
         "env": {
           "EVERART_API_KEY": "your_api_key_here"
         }
       }
     }
   }
   ```
3. Restart Cline to load the new MCP server

Once configured, you can use Cline to generate images with commands like:
- "Generate a minimalist tech logo in SVG format"
- "Create a photorealistic landscape image"
- "Make me a vector icon for my project"

## Features

- **Vector Graphics Generation**
  - Create SVG vector graphics using Recraft-Vector model
  - Automatic SVG optimization
  - Perfect for logos, icons, and scalable graphics

- **Raster Image Generation**
  - Support for PNG, JPEG, and WebP formats
  - Multiple AI models for different styles
  - High-quality image processing

- **Flexible Storage**
  - Custom output paths and filenames
  - Automatic directory creation
  - Format validation and extension handling
  - Default timestamped storage

## Available Models

- **5000:FLUX1.1**: Standard quality, general-purpose image generation
- **9000:FLUX1.1-ultra**: Ultra high quality for detailed images
- **6000:SD3.5**: Stable Diffusion 3.5 for diverse styles
- **7000:Recraft-Real**: Photorealistic style
- **8000:Recraft-Vector**: Vector art style (SVG output)

## Installation

### Installing via Smithery

To install EverArt Forge for Cline automatically via [Smithery](https://smithery.ai/server/@nickbaumann98/everart-forge-mcp):

```bash
npx -y @smithery/cli install @nickbaumann98/everart-forge-mcp --client cline
```

### Manual Installation
1. Clone the repository:
   ```bash
   git clone [repository-url]
   cd everart-forge-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Set up your EverArt API key in the MCP settings file.

## Usage

### Generate Vector Image (SVG)

```typescript
{
  "name": "generate_image",
  "arguments": {
    "prompt": "A minimalist tech logo with clean lines",
    "model": "8000",
    "format": "svg",
    "output_path": "/path/to/output/logo.svg"
  }
}
```

### Generate Raster Image (PNG/JPEG/WebP)

```typescript
{
  "name": "generate_image",
  "arguments": {
    "prompt": "A beautiful landscape painting",
    "model": "5000",
    "format": "png",
    "output_path": "/path/to/output/landscape.png"
  }
}
```

### List Generated Images

```typescript
{
  "name": "list_images"
}
```

### View Image

```typescript
{
  "name": "view_image",
  "arguments": {
    "filename": "generated_image.png"
  }
}
```

## Tool Parameters

### generate_image

- **prompt** (required): Text description of desired image
- **model** (optional): Model ID to use (default: "5000")
  - 5000:FLUX1.1 - Standard quality
  - 9000:FLUX1.1-ultra - Ultra high quality
  - 6000:SD3.5 - Stable Diffusion 3.5
  - 7000:Recraft-Real - Photorealistic style
  - 8000:Recraft-Vector - Vector art style
- **format** (optional): Output format (svg, png, jpg, webp)
  - Note: SVG format is only available with Recraft-Vector model
  - Default: "svg" for model 8000, "png" for others
- **output_path** (optional): Custom output path for the generated image
- **image_count** (optional): Number of images to generate (default: 1)

## Notes

- SVG format is only available with the Recraft-Vector (8000) model
- When using custom output paths, directories will be created automatically
- File extensions in output paths will be adjusted to match the specified format
- Images are optimized during saving (SVG optimization, raster format conversion)

## License

MIT License - see LICENSE file for details.

## Attribution

Based on the EverArt MCP Server implementation from modelcontextprotocol/servers.
