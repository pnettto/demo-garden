#!/bin/bash
set -e

if [[ "$(docker images -q demo-garden-image 2> /dev/null)" == "" ]]; then
  echo "Building Base VM image..."
  docker build -t demo-garden-image .
else
  echo "Base VM image already exists. Skipping build."
fi