from PIL import Image, ImageDraw, ImageFont

# Create a new image with a blue background
size = 32
img = Image.new('RGB', (size, size), color='#3b82f6')

# Initialize drawing context
draw = ImageDraw.Draw(img)

# Add a simple shape (circle in the middle)
margin = 4
draw.ellipse([margin, margin, size-margin, size-margin], fill='white')

# Save as ICO file
img.save('static/favicon.ico', format='ICO')