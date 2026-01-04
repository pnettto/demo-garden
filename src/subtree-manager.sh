#!/bin/bash

# subtree-manager.sh - Manage git subtrees

SUBTREES_FILE=".subtrees"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Cross-platform sed -i
sed_inplace() {
    if sed --version >/dev/null 2>&1; then
        # GNU sed (Linux)
        sed -i "$@"
    else
        # BSD sed (macOS)
        sed -i '' "$@"
    fi
}

# Initialize subtrees file if it doesn't exist
init_subtrees_file() {
    if [ ! -f "$SUBTREES_FILE" ]; then
        echo "# Format: local_path|source_folder|repository|branch" > "$SUBTREES_FILE"
    fi
}

# Add a subtree
add_subtree() {
    read -p "Enter local path where subtree will be added (example: services/my-app): " local_path
    local_path=${local_path:-services/my-app}
    read -p "Enter source folder in repository (default: root): " source_folder
    source_folder=${source_folder:-.}
    read -p "Enter repository URL: " repo
    read -p "Enter branch (default: main): " branch
    branch=${branch:-main}
    
    echo -e "${YELLOW}Adding subtree...${NC}"
    
    # Create a temporary directory to clone and extract
    temp_dir="temp-subtree-$$"
    
    if [ "$source_folder" = "." ]; then
        # No specific folder, add entire repo
        if [ "$local_path" = "." ]; then
            git subtree add --prefix "$temp_dir" "$repo" "$branch" --squash
            # Move contents to root
            shopt -s dotglob
            for item in "$temp_dir"/*; do
                git mv "$item" .
            done
            shopt -u dotglob
            git commit --amend -m "Add subtree from $repo to root"
            rm -rf "$temp_dir"
        else
            git subtree add --prefix "$local_path" "$repo" "$branch" --squash
        fi
    else
        # Extract specific folder from repo
        git clone --depth 1 --branch "$branch" "$repo" "$temp_dir" 2>/dev/null
        
        if [ ! -d "$temp_dir/$source_folder" ]; then
            echo -e "${RED}Source folder '$source_folder' not found in repository${NC}"
            rm -rf "$temp_dir"
            return
        fi
        
        # Copy the specific folder
        if [ "$local_path" = "." ]; then
            cp -r "$temp_dir/$source_folder"/* .
        else
            mkdir -p "$local_path"
            cp -r "$temp_dir/$source_folder"/* "$local_path/"
        fi
        
        rm -rf "$temp_dir"
        
        # Add and commit
        if [ "$local_path" = "." ]; then
            git add .
            git commit -m "Add subtree from $repo/$source_folder to root"
        else
            git add "$local_path"
            git commit -m "Add subtree from $repo/$source_folder to $local_path"
        fi
    fi
    
    if [ $? -eq 0 ]; then
        echo "$local_path|$source_folder|$repo|$branch" >> "$SUBTREES_FILE"
        echo -e "${GREEN}Subtree added successfully${NC}"
    else
        echo -e "${RED}Failed to add subtree${NC}"
    fi
}

# Update a subtree
update_subtree() {
    init_subtrees_file
    
    if [ ! -s "$SUBTREES_FILE" ] || [ $(wc -l < "$SUBTREES_FILE") -le 1 ]; then
        echo -e "${RED}No subtrees configured${NC}"
        return
    fi
    
    echo "Available subtrees:"
    grep -v "^#" "$SUBTREES_FILE" | awk '{print NR". "$0}'
    
    read -p "Enter number to update (or 'all' for all): " choice
    
    if [ "$choice" = "all" ]; then
        grep -v "^#" "$SUBTREES_FILE" | while IFS='|' read -r local_path source_folder repo branch; do
            [ -z "$local_path" ] && continue
            echo -e "${YELLOW}Updating $local_path...${NC}"
            update_single_subtree "$local_path" "$source_folder" "$repo" "$branch"
        done
    else
        line=$(grep -v "^#" "$SUBTREES_FILE" | sed -n "${choice}p")
        IFS='|' read -r local_path source_folder repo branch <<< "$line"
        
        if [ -z "$local_path" ]; then
            echo -e "${RED}Invalid selection${NC}"
            return
        fi
        
        echo -e "${YELLOW}Updating $local_path...${NC}"
        update_single_subtree "$local_path" "$source_folder" "$repo" "$branch"
    fi
    
    echo -e "${GREEN}Update complete${NC}"
}

# Helper function to update a single subtree
update_single_subtree() {
    local local_path="$1"
    local source_folder="$2"
    local repo="$3"
    local branch="$4"
    
    temp_dir="temp-subtree-update-$$"
    
    if [ "$source_folder" = "." ]; then
        # Update entire repo
        if [ "$local_path" = "." ]; then
            # For root, we need special handling
            git subtree pull --prefix "$temp_dir" "$repo" "$branch" --squash 2>/dev/null || {
                git subtree add --prefix "$temp_dir" "$repo" "$branch" --squash
            }
            shopt -s dotglob
            for item in "$temp_dir"/*; do
                [ -e "$item" ] && cp -r "$item" .
            done
            shopt -u dotglob
            git add .
            git commit -m "Update subtree from $repo"
            git rm -r "$temp_dir"
            git commit --amend -m "Update subtree from $repo"
        else
            git subtree pull --prefix "$local_path" "$repo" "$branch" --squash
        fi
    else
        # Update specific folder
        git clone --depth 1 --branch "$branch" "$repo" "$temp_dir" 2>/dev/null
        
        if [ ! -d "$temp_dir/$source_folder" ]; then
            echo -e "${RED}Source folder '$source_folder' not found in repository${NC}"
            rm -rf "$temp_dir"
            return
        fi
        
        # Remove old content
        if [ "$local_path" = "." ]; then
            # For root, be careful not to delete everything
            find . -maxdepth 1 -not -name '.git' -not -name '.' -not -name '..' -not -name "$SUBTREES_FILE" -exec rm -rf {} +
            cp -r "$temp_dir/$source_folder"/* .
        else
            rm -rf "$local_path"
            mkdir -p "$local_path"
            cp -r "$temp_dir/$source_folder"/* "$local_path/"
        fi
        
        rm -rf "$temp_dir"
        
        git add .
        if [ "$local_path" = "." ]; then
            git commit -m "Update subtree from $repo/$source_folder"
        else
            git commit -m "Update subtree from $repo/$source_folder to $local_path"
        fi
    fi
}

# Push changes to a subtree
push_subtree() {
    init_subtrees_file
    
    if [ ! -s "$SUBTREES_FILE" ] || [ $(wc -l < "$SUBTREES_FILE") -le 1 ]; then
        echo -e "${RED}No subtrees configured${NC}"
        return
    fi
    
    echo "Available subtrees:"
    grep -v "^#" "$SUBTREES_FILE" | awk '{print NR". "$0}'
    
    read -p "Enter number to push: " choice
    line=$(grep -v "^#" "$SUBTREES_FILE" | sed -n "${choice}p")
    IFS='|' read -r local_path source_folder repo branch <<< "$line"
    
    if [ -z "$local_path" ]; then
        echo -e "${RED}Invalid selection${NC}"
        return
    fi
    
    if [ "$source_folder" != "." ]; then
        echo -e "${YELLOW}Warning: Push for specific folders requires manual intervention${NC}"
        echo -e "${YELLOW}You'll need to manually push changes to $repo/$source_folder${NC}"
        return
    fi
    
    echo -e "${YELLOW}Pushing $local_path to $repo...${NC}"
    
    if [ "$local_path" = "." ]; then
        echo -e "${RED}Cannot push from root automatically. Use git subtree push manually.${NC}"
        return
    fi
    
    git subtree push --prefix "$local_path" "$repo" "$branch"
    
    echo -e "${GREEN}Push complete${NC}"
}

# Remove a subtree
remove_subtree() {
    init_subtrees_file
    
    if [ ! -s "$SUBTREES_FILE" ] || [ $(wc -l < "$SUBTREES_FILE") -le 1 ]; then
        echo -e "${RED}No subtrees configured${NC}"
        return
    fi
    
    echo "Available subtrees:"
    grep -v "^#" "$SUBTREES_FILE" | awk '{print NR". "$0}'
    
    read -p "Enter number to remove: " choice
    line=$(grep -v "^#" "$SUBTREES_FILE" | sed -n "${choice}p")
    IFS='|' read -r local_path source_folder repo branch <<< "$line"
    
    if [ -z "$local_path" ]; then
        echo -e "${RED}Invalid selection${NC}"
        return
    fi
    
    if [ "$local_path" = "." ]; then
        echo -e "${RED}Cannot remove root subtree automatically. Manual intervention required.${NC}"
        return
    fi
    
    read -p "Remove $local_path? This will delete the files. (y/N): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Cancelled"
        return
    fi
    
    echo -e "${YELLOW}Removing $local_path...${NC}"
    git rm -r "$local_path"
    git commit -m "Remove subtree: $local_path"
    
    # Remove from tracking file - escape special characters for grep
    escaped_path=$(echo "$local_path" | sed 's/[.[\*^$()+?{|]/\\&/g')
    grep -v "^$escaped_path|" "$SUBTREES_FILE" > "$SUBTREES_FILE.tmp"
    mv "$SUBTREES_FILE.tmp" "$SUBTREES_FILE"
    
    echo -e "${GREEN}Subtree removed${NC}"
}

# List subtrees
list_subtrees() {
    init_subtrees_file
    
    if [ ! -s "$SUBTREES_FILE" ] || [ $(wc -l < "$SUBTREES_FILE") -le 1 ]; then
        echo -e "${YELLOW}No subtrees configured${NC}"
        return
    fi
    
    echo -e "${GREEN}Configured subtrees:${NC}"
    echo "----------------------------------------"
    grep -v "^#" "$SUBTREES_FILE" | while IFS='|' read -r local_path source_folder repo branch; do
        [ -z "$local_path" ] && continue
        display_path=$local_path
        display_source=$source_folder
        [ "$local_path" = "." ] && display_path="root"
        [ "$source_folder" = "." ] && display_source="root"
        echo -e "${GREEN}Local Path:${NC} $display_path"
        echo -e "${GREEN}Source Folder:${NC} $display_source"
        echo -e "${GREEN}Repository:${NC} $repo"
        echo -e "${GREEN}Branch:${NC} $branch"
        echo "----------------------------------------"
    done
}

# Main menu
show_menu() {
    echo ""
    echo "=== Git Subtree Manager ==="
    echo "1. Add subtree"
    echo "2. Update subtree"
    echo "3. Push changes to subtree"
    echo "4. Remove subtree"
    echo "5. List subtrees"
    echo "6. Exit"
    echo ""
}

# Main loop
init_subtrees_file

while true; do
    show_menu
    read -p "Select option: " option
    
    case $option in
        1) add_subtree ;;
        2) update_subtree ;;
        3) push_subtree ;;
        4) remove_subtree ;;
        5) list_subtrees ;;
        6) echo "Goodbye!"; exit 0 ;;
        *) echo -e "${RED}Invalid option${NC}" ;;
    esac
done