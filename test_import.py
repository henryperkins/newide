try:
    import main
    print("Successfully imported main module")
    print("main.__file__:", main.__file__)
    print("main.app:", main.app)
except Exception as e:
    print(f"Failed to import main module: {e}")

try:
    from main import app
    print("Successfully imported app from main")
except Exception as e:
    print(f"Failed to import app from main: {e}")
