package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"

	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"gopkg.in/yaml.v3"
)

var (
	projectName     = getEnv("PROJECT_NAME", "demos")
	demosDir        = getEnv("DEMOS_DIR", "/demos-dir")
	idleTimeout     = getDurationEnv("IDLE_TIMEOUT", 10)
	serviceActivity = make(map[string]time.Time)
	serviceLocks    = make(map[string]*sync.Mutex)
	serviceRequests = make(map[string]int)
	mu              sync.Mutex
	locksMu         sync.Mutex
	dockerClient    *client.Client
)

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func getDurationEnv(key string, fallback int) time.Duration {
	if value, ok := os.LookupEnv(key); ok {
		if v, err := strconv.Atoi(value); err == nil {
			return time.Duration(v) * time.Second
		}
	}
	return time.Duration(fallback) * time.Second
}

func getServiceLock(name string) *sync.Mutex {
	locksMu.Lock()
	defer locksMu.Unlock()
	if _, ok := serviceLocks[name]; !ok {
		serviceLocks[name] = &sync.Mutex{}
	}
	return serviceLocks[name]
}

func updateActivity(name string, delta int) {
	mu.Lock()
	defer mu.Unlock()
	serviceRequests[name] += delta
	serviceActivity[name] = time.Now()
}

func getContainer(ctx context.Context, serviceName string) (*types.Container, error) {
	f := filters.NewArgs()
	f.Add("label", fmt.Sprintf("com.docker.compose.service=%s", serviceName))
	f.Add("label", fmt.Sprintf("com.docker.compose.project=%s", projectName))

	containers, err := dockerClient.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: f,
	})
	if err != nil {
		return nil, err
	}
	if len(containers) == 0 {
		return nil, nil
	}
	return &containers[0], nil
}

// findServiceDirectory finds the directory containing a service's docker-compose.yml
func findServiceDirectory(serviceName string) (string, error) {
	mainComposePath := filepath.Join(demosDir, "docker-compose.yml")

	// Read main compose file
	data, err := os.ReadFile(mainComposePath)
	if err != nil {
		return "", fmt.Errorf("failed to read main compose file: %w", err)
	}

	// Parse to get includes
	var mainCompose struct {
		Include []string `yaml:"include"`
	}
	if err := yaml.Unmarshal(data, &mainCompose); err != nil {
		return "", fmt.Errorf("failed to parse main compose file: %w", err)
	}

	// Search each included compose file for the service
	for _, includePath := range mainCompose.Include {
		fullPath := filepath.Join(demosDir, includePath)

		// Read included compose file
		includeData, err := os.ReadFile(fullPath)
		if err != nil {
			log.Printf("Warning: could not read %s: %v", fullPath, err)
			continue
		}

		// Parse to check if it contains the service
		var includeCompose struct {
			Services map[string]interface{} `yaml:"services"`
		}
		if err := yaml.Unmarshal(includeData, &includeCompose); err != nil {
			log.Printf("Warning: could not parse %s: %v", fullPath, err)
			continue
		}

		// Check if this compose file defines the service
		if _, exists := includeCompose.Services[serviceName]; exists {
			// Return the directory containing this compose file
			return filepath.Dir(fullPath), nil
		}
	}

	return "", fmt.Errorf("service %s not found in any included compose file", serviceName)
}

func ensureServiceRunning(ctx context.Context, serviceName string, targetPort string) error {
	c, err := getContainer(ctx, serviceName)
	if err != nil {
		return err
	}

	if c == nil || c.State != "running" {
		lock := getServiceLock(serviceName)
		lock.Lock()
		defer lock.Unlock()

		// Re-check
		c, err = getContainer(ctx, serviceName)
		if err != nil {
			return err
		}

		if c == nil || c.State != "running" {
			log.Printf("Starting service: %s", serviceName)

			// Build base command
			args := []string{"compose", "-p", projectName, "--profile", "lazy",
				"-f", filepath.Join(demosDir, "docker-compose.yml")}

			envPath, err := findServiceDirectory(serviceName)
			if err != nil {
				log.Printf("Error: %v", err)
				return err
			}
			fullEnvPath := filepath.Join(envPath, ".env")
			if _, err := os.Stat(fullEnvPath); err == nil {
				args = append(args, "--env-file", fullEnvPath)
			} else {
				log.Printf("Optional .env file not found at %s, skipping.", fullEnvPath)
			}

			args = append(args, "up", "-d", "--build", serviceName)

			cmd := exec.Command("docker", args...)
			cmd.Dir = demosDir
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("failed to start service: %w", err)
			}

			// Wait for it to be ready
			for i := 0; i < 30; i++ {
				c, err = getContainer(ctx, serviceName)
				if err == nil && c != nil && c.State == "running" {
					// Container is running, now wait for the port to be open
					if err := waitForPort(fmt.Sprintf("%s:%s", serviceName, targetPort), 30*time.Second); err != nil {
						return fmt.Errorf("service %s running but port %s not ready: %w", serviceName, targetPort, err)
					}
					return nil
				}
				time.Sleep(1 * time.Second)
			}
			return fmt.Errorf("service %s failed to start in time", serviceName)
		}
	}
	return nil
}

func waitForPort(addr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 1*time.Second)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("timeout waiting for %s", addr)
}

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	targetService := r.Header.Get("x-target-service")
	targetPort := r.Header.Get("x-target-port")

	if targetService == "" || targetPort == "" {
		http.Error(w, "Missing X-Target-Service or X-Target-Port headers", http.StatusBadRequest)
		return
	}

	updateActivity(targetService, 1)
	defer updateActivity(targetService, -1)

	ctx := r.Context()
	if err := ensureServiceRunning(ctx, targetService, targetPort); err != nil {
		log.Printf("Error ensuring service %s is running: %v", targetService, err)
		http.Error(w, fmt.Sprintf("Proxy error: %v", err), http.StatusBadGateway)
		return
	}

	targetURL, _ := url.Parse(fmt.Sprintf("http://%s:%s", targetService, targetPort))

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	// Custom Director to handle headers like the Python version
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Header.Del("host")
		req.Header.Del("x-target-service")
		req.Header.Del("x-target-port")
		req.Header.Del("accept-encoding")
	}

	// Python version filtered response headers
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Connection")
		resp.Header.Del("Keep-Alive")
		resp.Header.Del("Proxy-Authenticate")
		resp.Header.Del("Proxy-Authorization")
		resp.Header.Del("TE")
		resp.Header.Del("Trailers")
		resp.Header.Del("Transfer-Encoding")
		resp.Header.Del("Upgrade")
		return nil
	}

	proxy.ServeHTTP(w, r)
}

func monitorServices() {
	for {
		time.Sleep(10 * time.Second)
		now := time.Now()
		ctx := context.Background()

		// Discover
		containers, err := dockerClient.ContainerList(ctx, container.ListOptions{})
		if err == nil {
			mu.Lock()
			for _, c := range containers {
				serviceName := c.Labels["com.docker.compose.service"]
				if c.Labels["lazy"] == "true" && serviceName != "" {
					if _, ok := serviceActivity[serviceName]; !ok {
						log.Printf("Discovered lazy service: %s, starting idle timer", serviceName)
						serviceActivity[serviceName] = now
					}
				}
			}
			mu.Unlock()
		}

		mu.Lock()
		for name, lastActive := range serviceActivity {
			if serviceRequests[name] > 0 {
				continue
			}

			if now.Sub(lastActive) > idleTimeout {
				c, err := getContainer(ctx, name)
				if err == nil && c != nil {
					if c.State == "running" {
						log.Printf("Idle timeout reached for %s. Stopping...", name)
						timeout := 10
						err := dockerClient.ContainerStop(ctx, c.ID, container.StopOptions{Timeout: &timeout})
						if err != nil {
							log.Printf("Error stopping %s: %v", name, err)
						} else {
							log.Printf("Stopped %s", name)
						}
					} else {
						delete(serviceActivity, name)
					}
				} else {
					delete(serviceActivity, name)
				}
			}
		}
		mu.Unlock()
	}
}

func main() {
	var err error
	dockerClient, err = client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatalf("Failed to create docker client: %v", err)
	}

	go monitorServices()

	http.HandleFunc("/", proxyHandler)
	log.Println("Go Lazy Manager starting on :8001")
	log.Fatal(http.ListenAndServe(":8001", nil))
}
