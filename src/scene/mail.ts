/** Truck speed in tiles per second, and how long it stays at the mailbox. */
const SPEED = 3;
const STOP = 1.2;

/**
 * The mailbox and the mail truck that serves it. Pure logic — no rendering.
 * The truck drives in from `lane.from` to `lane.stop`, stops, then drives back out;
 * each stop collects every posted letter and drops every requested delivery.
 */
export class MailService {
  readonly truck: { x: number; facing: "in" | "out"; state: "away" | "arriving" | "stopped" | "leaving" };
  readonly box: { outgoing: number; incoming: string[] /* addressee ids */ } = { outgoing: 0, incoming: [] };
  onDelivered?: (agentId: string) => void;
  private pickup = false;
  private toDeliver: string[] = [];
  private stopLeft = 0;

  constructor(private readonly lane: { from: number; stop: number }) {
    this.truck = { x: lane.from, facing: "in", state: "away" };
  }

  get flagUp(): boolean {
    return this.box.outgoing > 0 || this.box.incoming.length > 0;
  }

  requestPickup(): void {
    this.pickup = true;
  }

  requestDelivery(agentId: string): void {
    this.toDeliver.push(agentId);
  }

  /** Removes one letter addressed to `agentId` from the mailbox; false when there is none. */
  takeLetter(agentId: string): boolean {
    const i = this.box.incoming.indexOf(agentId);
    if (i < 0) return false;
    this.box.incoming.splice(i, 1);
    return true;
  }

  post(): void {
    this.box.outgoing++;
  }

  update(dt: number): void {
    const t = this.truck;
    switch (t.state) {
      case "away":
        if (this.pickup || this.toDeliver.length) {
          t.state = "arriving";
          t.facing = "in";
        }
        break;
      case "arriving":
        t.x = Math.max(this.lane.stop, t.x - SPEED * dt);
        if (t.x === this.lane.stop) {
          t.state = "stopped";
          this.stopLeft = STOP;
        }
        break;
      case "stopped":
        // Served every frame of the stop, so mail requested while it stands there goes too.
        this.box.outgoing = 0;
        this.pickup = false;
        for (const id of this.toDeliver.splice(0)) {
          this.box.incoming.push(id);
          this.onDelivered?.(id);
        }
        this.stopLeft -= dt;
        if (this.stopLeft <= 0) {
          t.state = "leaving";
          t.facing = "out";
        }
        break;
      case "leaving":
        t.x = Math.min(this.lane.from, t.x + SPEED * dt);
        if (t.x === this.lane.from) t.state = "away";
        break;
    }
  }
}
