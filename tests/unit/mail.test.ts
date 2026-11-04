import { describe, expect, it } from "vitest";
import { MailService } from "../../src/scene/mail";
import { OFFICE } from "../../src/world/layout";

const step = 1 / 30;
/** Runs until `done` holds (or `limit` seconds pass); returns whether it held. */
function until(mail: MailService, done: () => boolean, limit = 30): boolean {
  for (let t = 0; t < limit; t += step) {
    if (done()) return true;
    mail.update(step);
  }
  return done();
}

describe("mail truck", () => {
  it("a pickup brings the truck, takes the outgoing mail, and leaves", () => {
    const mail = new MailService(OFFICE.truckLane);
    expect(mail.truck.state).toBe("away");
    mail.post();
    expect(mail.flagUp).toBe(true);
    mail.requestPickup();
    const seen: string[] = [];
    let outgoingWhileStopped = -1;
    until(mail, () => {
      if (seen.at(-1) !== mail.truck.state) seen.push(mail.truck.state);
      if (mail.truck.state === "stopped") outgoingWhileStopped = mail.box.outgoing;
      return seen.length > 1 && mail.truck.state === "away";
    });
    expect(seen).toEqual(["away", "arriving", "stopped", "leaving", "away"]);
    expect(outgoingWhileStopped).toBe(0);
    expect(mail.flagUp).toBe(false);
    expect(mail.truck.x).toBe(OFFICE.truckLane.from);
  });

  it("deliveries are dropped in one trip and announced", () => {
    const mail = new MailService(OFFICE.truckLane);
    const delivered: string[] = [];
    let trips = 0;
    mail.onDelivered = (id) => delivered.push(id);
    mail.requestDelivery("a");
    mail.requestDelivery("b");
    let last = mail.truck.state;
    until(mail, () => {
      if (last !== "arriving" && mail.truck.state === "arriving") trips++;
      last = mail.truck.state;
      return trips > 0 && mail.truck.state === "away";
    });
    expect(trips).toBe(1);
    expect(delivered).toEqual(["a", "b"]);
    expect(mail.box.incoming).toEqual(["a", "b"]);
    expect(mail.flagUp).toBe(true);
    expect(mail.takeLetter("a")).toBe(true);
    expect(mail.takeLetter("a")).toBe(false);
    expect(mail.takeLetter("b")).toBe(true);
    expect(mail.flagUp).toBe(false);
  });

  it("mail requested while leaving triggers a second trip", () => {
    const mail = new MailService(OFFICE.truckLane);
    const delivered: string[] = [];
    mail.onDelivered = (id) => delivered.push(id);
    mail.requestDelivery("a");
    expect(until(mail, () => mail.truck.state === "leaving")).toBe(true);
    mail.requestDelivery("b");
    expect(until(mail, () => mail.truck.state === "away")).toBe(true);
    expect(delivered).toEqual(["a"]);
    expect(until(mail, () => mail.truck.state === "stopped")).toBe(true);
    mail.update(step);
    expect(delivered).toEqual(["a", "b"]);
  });
});
