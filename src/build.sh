#!/bin/bash
set -e

if [[ "$(docker images -q demo-garden 2> /dev/null)" == "" ]]; then
  echo "Building Base VM image..."
  docker build -t demo-garden .
else
  echo "Base VM image already exists. Skipping build."
fi