#!/bin/bash

# Prompt for submodule path
read -p "Enter submodule path (relative to repo root): " SUBMODULE_PATH

# Trim whitespace
SUBMODULE_PATH=$(echo "$SUBMODULE_PATH" | xargs)

# Check if path is empty
if [ -z "$SUBMODULE_PATH" ]; then
    echo "Error: No path provided"
    exit 1
fi

# Check if it's actually a submodule
if ! git config -f .gitmodules --get-regexp "submodule\.$SUBMODULE_PATH" > /dev/null 2>&1; then
    echo "Warning: $SUBMODULE_PATH is not a registered submodule"
    read -p "Continue anyway? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ]; then
        exit 0
    fi
fi

echo "Removing submodule: $SUBMODULE_PATH"

# Deinitialize the submodule
git submodule deinit -f "$SUBMODULE_PATH" 2>/dev/null

# Remove from index and working tree
git rm -f "$SUBMODULE_PATH" 2>/dev/null

# Remove submodule directory from .git/modules
rm -rf ".git/modules/$SUBMODULE_PATH"

# Commit the changes
git commit -m "Remove submodule $SUBMODULE_PATH"

echo "Submodule removed successfully"