#!/bin/bash

# Get current branch name
BRANCH=$(git branch --show-current)

# Get repository info from remote URL
REPO_URL=$(git remote get-url origin)

# Extract owner and repo name from URL
# Handles both HTTPS and SSH URLs
if [[ $REPO_URL =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
    OWNER="${BASH_REMATCH[1]}"
    REPO="${BASH_REMATCH[2]}"
else
    echo "Could not parse GitHub repository URL"
    exit 1
fi

# Construct PR creation URL
PR_URL="https://github.com/${OWNER}/${REPO}/compare/main...${BRANCH}"

echo "Opening PR creation page for branch: $BRANCH"
echo "URL: $PR_URL"
echo ""
echo "Remember to add this line to your PR description:"
echo "Co-Authored-By: Warp <agent@warp.dev>"
echo ""

# Open in default browser
open "$PR_URL"
