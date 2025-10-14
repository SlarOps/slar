#!/bin/bash

cat docker-compose.yaml | sed 's/ghcr.io\/slarops\//192.168.100.137:5000\/slarops\//g' | docker compose -f - build

cat docker-compose.yaml | sed 's/ghcr.io\/slarops\//192.168.100.137:5000\/slarops\//g' | docker compose -f - push

kubectl rollout restart deployment slar-api -n slar
kubectl rollout restart deployment slar-web -n slar
kubectl rollout restart deployment slar-ai -n slar
kubectl rollout restart deployment slar-terminal -n slar
kubectl rollout restart deployment slar-slack-worker -n slar