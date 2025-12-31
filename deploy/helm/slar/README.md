```
cp cfg.ex.yaml config.yaml
kubectl create secret generic slar-config --from-file=config.yaml
```