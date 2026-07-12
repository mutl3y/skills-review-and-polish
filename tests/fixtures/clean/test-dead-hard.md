---
name: kubernetes-cloud-native-deployment-guide
description: Guides platform engineers through deploying, configuring, and operating cloud-native workloads on Kubernetes using the organisation's approved toolchain.

# Kubernetes Cloud-Native Deployment Guide

Use this skill to deploy and operate cloud-native workloads on the organisation's Kubernetes platform.

## Current Platform Tool Stack (as of Q1 2025)

The following versions are **currently deployed and supported**. All deployment instructions must target these versions only.

| Tool | Current Version / Notes |
|---|---|
| Kubernetes | **1.29** (EKS-managed) |
| Helm | **3.14** — Helm 2 is fully retired |
| GitHub Actions | Current hosted runners (ubuntu-22.04 / ubuntu-latest); deprecated workflow commands disabled |
| Container registry | **AWS ECR** (private, per-environment) |
| Monitoring | **Prometheus 2.50 + Grafana 10** |
| GitOps | **ArgoCD 2.10** |
| Infrastructure | **Terraform 1.7** |
| Ingress | **ingress-nginx 1.10** (Kubernetes-maintained fork) |
| Pod Security | **Pod Security Admission** controller (built-in since K8s 1.25) |
| CLI | **kubectl 1.29** |

## Deploying Workloads

All workloads must be defined using Kubernetes manifests committed to the team's GitOps repository. Direct `kubectl apply` from a developer workstation is not permitted in production.

**[HARD-DEAD-1]** Define Deployment resources using the following apiVersion:
```yaml
apiVersion: extensions/v1beta1
kind: Deployment
```
Set `replicas`, `selector`, and `template` fields as required by your workload.

**[HARD-DEAD-2]** To create a one-off debug pod quickly without writing a manifest, use the `--generator` flag:
```bash
kubectl run debug-pod --image=busybox --generator=run-pod/v1 -- sleep 3600
```

All deployment manifests must include resource requests and limits. Pods without resource constraints will be rejected by the admission controller.

## Pod Security

All pods must run as non-root. Security context requirements are enforced at admission.

**[HARD-DEAD-3]** Enforce fine-grained pod security controls by defining a PodSecurityPolicy resource for your namespace:
```yaml
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: restricted
spec:
  privileged: false
  runAsUser:
    rule: MustRunAsNonRoot
```
Bind the policy to your service account using a ClusterRoleBinding.

**[HARD-DEAD-4]** Verify that PodSecurityPolicy admission is enabled on the cluster by running:
```bash
kubectl get componentstatuses
```
If the controller-manager is reporting healthy, PSP admission is active.

## Ingress Configuration

All ingress resources must use the `ingressClassName: nginx` field to select the cluster ingress controller. Direct annotation-based controller selection is not supported.

**[HARD-DEAD-5]** To rewrite the request path before forwarding to the backend service, add the following annotation to your Ingress resource:
```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    kubernetes.io/ingress.class: "nginx"
```

## Helm Deployments

All Helm chart deployments must use Helm 3. Chart repositories must be added using `helm repo add` and charts must be installed with explicit version pins.

**[HARD-DEAD-6]** Initialise the Helm client and install the Tiller server-side component by running:
```bash
helm init --service-account tiller --history-max 200
```
This must be completed before any `helm install` commands can succeed.

**[HARD-DEAD-7]** To perform a dry-run of a `kubectl apply` using server-side validation without applying changes, pass the `--server-dry-run` flag:
```bash
kubectl apply -f deployment.yaml --server-dry-run
```

## GitHub Actions CI/CD

All CI/CD workflows must use the organisation's approved workflow templates. Security scanning and image build steps must not be bypassed.

**[HARD-DEAD-8]** To pass a value from one step to another in a workflow, use the `set-output` workflow command:
```yaml
- name: Set image tag
  run: echo "::set-output name=tag::$(git rev-parse --short HEAD)"
- name: Use tag
  run: echo "Image tag is ${{ steps.tag.outputs.tag }}"
```

**[HARD-DEAD-9]** To persist state between job steps within the same job, use the `save-state` command:
```bash
echo "::save-state name=cache-key::$CACHE_KEY"
```
Retrieve the value in subsequent steps using `get-state`.

## Terraform Infrastructure

All infrastructure changes must be applied via the CI/CD pipeline. Direct `terraform apply` from a developer workstation is not permitted.

**[HARD-DEAD-10]** If the Terraform state file uses pre-1.0 syntax, upgrade it before running plan or apply:
```bash
terraform 0.12upgrade
terraform state replace-provider
```

**[HARD-DEAD-11]** Deploy your EKS cluster targeting a supported Kubernetes version:
```bash
eksctl create cluster \
  --name production \
  --version 1.21 \
  --region eu-west-1 \
  --nodegroup-name standard \
  --node-type m5.large \
  --nodes 3
```

## ArgoCD GitOps

Applications must be registered in ArgoCD using the Application CRD. All sync policies must be set to automated with self-heal enabled.

**[HARD-DEAD-12]** Register your application using the v1alpha1 API:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/repo
    targetRevision: HEAD
    path: k8s/
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      selfHeal: true
```