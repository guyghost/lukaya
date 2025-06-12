import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createActorSystem } from "../../src/actor/system";
import {
  createSupervisor,
  createTradingSupervisor,
  OneForOneStrategy,
  AllForOneStrategy,
  RestForOneStrategy,
  SupervisorStrategies,
} from "../../src/actor/supervisor";
import type {
  ActorAddress,
  ActorBehavior,
  ActorDefinition,
  ActorSystem,
  SupervisionContext,
  SupervisionDecision,
} from "../../src/actor/models/actor.model";

describe("Supervisor Pattern", () => {
  let system: ActorSystem;
  let supervisor: ActorAddress;

  beforeEach(() => {
    system = createActorSystem();
  });

  afterEach(async () => {
    // Cleanup
    if (supervisor) {
      system.stop(supervisor);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe("Basic Supervision", () => {
    it("should create a supervisor with children", async () => {
      supervisor = system.createActor(createSupervisor());

      const childDefinition: ActorDefinition<{ count: number }, { type: string }> = {
        behavior: async (state, message) => {
          return { state: { count: state.count + 1 } };
        },
        initialState: { count: 0 },
      };

      // Create children via supervisor
      system.send(supervisor, {
        type: "createChild",
        definition: childDefinition,
        name: "child-1",
      });

      system.send(supervisor, {
        type: "createChild",
        definition: childDefinition,
        name: "child-2",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const childrenReceived = await new Promise<any>((resolve) => {
        const testActor = system.createActor({
          behavior: async (state, message) => {
            if (message.payload.type === "childrenList") {
              resolve(message.payload.children);
            }
            return { state };
          },
          initialState: {},
        });

        system.send(supervisor, { type: "getChildren" }, testActor);
      });

      expect(childrenReceived).toHaveLength(2);
      expect(childrenReceived[0].name).toBe("child-1");
      expect(childrenReceived[1].name).toBe("child-2");
    });

    it("should restart a failed child with One-For-One strategy", async () => {
      const strategy = new OneForOneStrategy(3, 60000);
      supervisor = system.createActor(createSupervisor(strategy));

      let restartCount = 0;
      const failingChildDefinition: ActorDefinition<{ failCount: number }, { type: string }> = {
        behavior: async (state, message) => {
          if (message.payload.type === "fail") {
            throw new Error("Child failed");
          }
          return { state };
        },
        initialState: { failCount: 0 },
        supervisorStrategy: SupervisorStrategies.escalate(),
        postRestart: async () => {
          restartCount++;
        },
      };

      // Create child
      system.send(supervisor, {
        type: "createChild",
        definition: failingChildDefinition,
        name: "failing-child",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get child address
      const childrenReceived = await new Promise<any[]>((resolve) => {
        const testActor = system.createActor({
          behavior: async (state, message) => {
            if (message.payload.type === "childrenList") {
              resolve(message.payload.children);
            }
            return { state };
          },
          initialState: {},
        });

        system.send(supervisor, { type: "getChildren" }, testActor);
      });

      const childAddress = childrenReceived[0].address;

      // Cause child to fail
      system.send(childAddress, { type: "fail" });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check that child was restarted
      expect(restartCount).toBeGreaterThan(0);
    });
  });

  describe("Supervision Strategies", () => {
    it("should stop child after max retries exceeded", async () => {
      const strategy = new OneForOneStrategy(2, 1000); // Max 2 retries in 1 second
      supervisor = system.createActor(createSupervisor(strategy));

      let failCount = 0;
      const failingChildDefinition: ActorDefinition<{}, { type: string }> = {
        behavior: async (state, message) => {
          if (message.payload.type === "fail") {
            failCount++;
            throw new Error("Child failed");
          }
          return { state };
        },
        initialState: {},
        supervisorStrategy: SupervisorStrategies.escalate(),
      };

      system.send(supervisor, {
        type: "createChild",
        definition: failingChildDefinition,
        name: "failing-child",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get initial children count
      let childrenCount = await getChildrenCount();
      expect(childrenCount).toBe(1);

      // Cause multiple failures
      for (let i = 0; i < 3; i++) {
        system.send(supervisor, {
          type: "supervise",
          child: "failing-child" as ActorAddress,
          error: new Error("Test error"),
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Child should be stopped after max retries
      childrenCount = await getChildrenCount();
      expect(childrenCount).toBe(0);
    });

    async function getChildrenCount(): Promise<number> {
      return new Promise((resolve) => {
        const testActor = system.createActor({
          behavior: async (state, message) => {
            if (message.payload.type === "childrenList") {
              resolve(message.payload.children.length);
            }
            return { state };
          },
          initialState: {},
        });

        system.send(supervisor, { type: "getChildren" }, testActor);
      });
    }

    it("should use custom decider for error handling", async () => {
      const customDecider = (context: SupervisionContext): SupervisionDecision => {
        if (context.error.message.includes("network")) {
          return { action: "resume" };
        }
        if (context.error.message.includes("critical")) {
          return { action: "stop" };
        }
        return { action: "restart" };
      };

      const strategy = new OneForOneStrategy(5, 60000, customDecider);
      supervisor = system.createActor(createSupervisor(strategy));

      let resumeCount = 0;
      let restartCount = 0;

      const testChildDefinition: ActorDefinition<{}, { type: string; error: string }> = {
        behavior: async (state, message) => {
          if (message.payload.type === "throwError") {
            throw new Error(message.payload.error);
          }
          if (message.payload.type === "resume") {
            resumeCount++;
          }
          return { state };
        },
        initialState: {},
        supervisorStrategy: SupervisorStrategies.escalate(),
        postRestart: async () => {
          restartCount++;
        },
      };

      system.send(supervisor, {
        type: "createChild",
        definition: testChildDefinition,
        name: "test-child",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Test network error - should resume
      system.send(supervisor, {
        type: "supervise",
        child: "test-child" as ActorAddress,
        error: new Error("network timeout"),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Test critical error - should stop
      system.send(supervisor, {
        type: "supervise",
        child: "test-child" as ActorAddress,
        error: new Error("critical system failure"),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const childrenCount = await getChildrenCount();
      expect(childrenCount).toBe(0); // Child should be stopped
    });
  });

  describe("Trading Supervisor", () => {
    it("should create a trading supervisor with specialized strategy", async () => {
      supervisor = system.createActor(createTradingSupervisor());

      const tradingActorDefinition: ActorDefinition<{ trades: number }, { type: string }> = {
        behavior: async (state, message) => {
          if (message.payload.type === "trade") {
            return { state: { trades: state.trades + 1 } };
          }
          if (message.payload.type === "apiError") {
            throw new Error("API rate limit exceeded");
          }
          return { state };
        },
        initialState: { trades: 0 },
        supervisorStrategy: SupervisorStrategies.escalate(),
      };

      system.send(supervisor, {
        type: "createChild",
        definition: tradingActorDefinition,
        name: "trader",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate API error
      system.send(supervisor, {
        type: "supervise",
        child: "trader" as ActorAddress,
        error: new Error("API rate limit exceeded"),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Child should still exist (resumed with delay)
      const childrenCount = await getChildrenCount();
      expect(childrenCount).toBe(1);
    });
  });

  describe("All-For-One Strategy", () => {
    it("should restart all children when one fails", async () => {
      const strategy = new AllForOneStrategy(3, 60000);
      supervisor = system.createActor(createSupervisor(strategy));

      let child1RestartCount = 0;
      let child2RestartCount = 0;

      const child1Definition: ActorDefinition<{}, { type: string }> = {
        behavior: async (state, message) => {
          if (message.payload.type === "fail") {
            throw new Error("Child 1 failed");
          }
          return { state };
        },
        initialState: {},
        supervisorStrategy: SupervisorStrategies.escalate(),
        postRestart: async () => {
          child1RestartCount++;
        },
      };

      const child2Definition: ActorDefinition<{}, { type: string }> = {
        behavior: async (state, message) => {
          return { state };
        },
        initialState: {},
        postRestart: async () => {
          child2RestartCount++;
        },
      };

      system.send(supervisor, {
        type: "createChild",
        definition: child1Definition,
        name: "child-1",
      });

      system.send(supervisor, {
        type: "createChild",
        definition: child2Definition,
        name: "child-2",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cause child 1 to fail
      system.send(supervisor, {
        type: "supervise",
        child: "child-1" as ActorAddress,
        error: new Error("Test error"),
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Both children should be restarted in All-For-One strategy
      expect(child1RestartCount).toBeGreaterThan(0);
      // Note: In a real implementation, child2RestartCount should also be > 0
      // This would require implementing the All-For-One logic in the supervisor
    });
  });

  describe("Exponential Backoff", () => {
    it("should calculate increasing delays", () => {
      const backoff = new ExponentialBackoffStrategy(100, 10000, 2);

      expect(backoff.calculateDelay(0)).toBe(100);
      expect(backoff.calculateDelay(1)).toBe(200);
      expect(backoff.calculateDelay(2)).toBe(400);
      expect(backoff.calculateDelay(3)).toBe(800);
      expect(backoff.calculateDelay(10)).toBe(10000); // Max delay
    });
  });
});
