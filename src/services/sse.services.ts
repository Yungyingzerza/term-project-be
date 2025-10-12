import { Response } from "express";

interface SSEClient {
  userId: string;
  res: Response;
}

class SSEService {
  private clients: Map<string, SSEClient[]> = new Map();

  // Add a client connection
  addClient(userId: string, res: Response) {
    const client: SSEClient = { userId, res };

    if (!this.clients.has(userId)) {
      this.clients.set(userId, []);
    }

    this.clients.get(userId)!.push(client);

    // Setup SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable buffering in nginx
    });

    // Send initial connection message
    this.sendEvent(res, {
      type: "connected",
      timestamp: new Date().toISOString(),
    });

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      this.sendEvent(res, {
        type: "heartbeat",
        timestamp: new Date().toISOString(),
      });
    }, 30000);

    // Clean up on connection close
    res.on("close", () => {
      clearInterval(heartbeatInterval);
      this.removeClient(userId, res);
    });
  }

  // Remove a client connection
  private removeClient(userId: string, res: Response) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      const filtered = userClients.filter((client) => client.res !== res);
      if (filtered.length === 0) {
        this.clients.delete(userId);
      } else {
        this.clients.set(userId, filtered);
      }
    }
  }

  // Send event to a specific user (all their connections)
  sendToUser(userId: string, data: any) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.forEach((client) => {
        this.sendEvent(client.res, data);
      });
    }
  }

  // Send event to multiple users
  sendToUsers(userIds: string[], data: any) {
    userIds.forEach((userId) => {
      this.sendToUser(userId, data);
    });
  }

  // Send event through SSE
  private sendEvent(res: Response, data: any) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error("Error sending SSE event:", error);
    }
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.clients.size;
  }

  // Get total connections count
  getTotalConnectionsCount(): number {
    let count = 0;
    this.clients.forEach((clients) => {
      count += clients.length;
    });
    return count;
  }

  // Check if user is connected
  isUserConnected(userId: string): boolean {
    return this.clients.has(userId) && this.clients.get(userId)!.length > 0;
  }
}

// Export singleton instance
export const sseService = new SSEService();
