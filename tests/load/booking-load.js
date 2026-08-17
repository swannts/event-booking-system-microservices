import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate } from "k6/metrics";

const profile = __ENV.PROFILE || "oversell";
const vus = Number(__ENV.VUS || (profile === "oversell" ? 250 : 10));
const capacity = Number(__ENV.CAPACITY || (profile === "smoke" ? 10 : 100));
const iterations = Number(__ENV.ITERATIONS || (profile === "smoke" ? 15 : 250));
const duration = __ENV.DURATION || "30s";
const baseUrls = {
  users: __ENV.USER_SERVICE_URL || "http://127.0.0.1:3000",
  events: __ENV.EVENT_SERVICE_URL || "http://127.0.0.1:3001",
  bookings: __ENV.BOOKING_SERVICE_URL || "http://127.0.0.1:3002"
};

const bookingRequests = new Counter("booking_requests_total");
const bookingSuccessRate = new Rate("booking_success_rate");
const bookingFailureRate = new Rate("booking_failure_rate");

const scenarios =
  profile === "steady"
    ? {
        booking_load: {
          executor: "constant-vus",
          vus,
          duration,
          gracefulStop: "10s"
        }
      }
    : {
        booking_load: {
          executor: "shared-iterations",
          vus,
          iterations,
          maxDuration: duration
        }
      };

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    checks: ["rate>0.99"]
  },
  summaryTrendStats: ["avg", "min", "med", "p(50)", "p(95)", "p(99)", "max"]
};

function jsonRequest(method, url, body, params = {}) {
  return http.request(method, url, body ? JSON.stringify(body) : null, {
    ...params,
    headers: { "Content-Type": "application/json", ...(params.headers || {}) }
  });
}

export function setup() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const userResponse = jsonRequest("POST", `${baseUrls.users}/users`, {
    name: "k6 Load User",
    email: `k6-${suffix}@example.com`
  });
  check(userResponse, { "load user created": (response) => response.status === 201 });
  if (userResponse.status !== 201) {
    fail(`Unable to create load user: ${userResponse.status} ${userResponse.body}`);
  }

  const eventResponse = jsonRequest("POST", `${baseUrls.events}/events`, {
    title: `k6 Limited Capacity Event ${suffix}`,
    totalSeats: capacity,
    date: new Date(Date.now() + 86_400_000).toISOString()
  });
  check(eventResponse, { "load event created": (response) => response.status === 201 });
  if (eventResponse.status !== 201) {
    fail(`Unable to create load event: ${eventResponse.status} ${eventResponse.body}`);
  }

  return {
    userId: userResponse.json("id"),
    eventId: eventResponse.json("id"),
    totalSeats: capacity,
    suffix
  };
}

export default function (data) {
  const response = jsonRequest(
    "POST",
    `${baseUrls.bookings}/bookings`,
    { userId: data.userId, eventId: data.eventId, quantity: 1 },
    {
      headers: {
        "Idempotency-Key": `k6-${data.suffix}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`
      },
      tags: { operation: "create_booking" }
    }
  );

  bookingRequests.add(1);
  const accepted = response.status === 201;
  bookingSuccessRate.add(accepted);
  bookingFailureRate.add(!accepted);
  check(response, {
    "booking API remains responsive": (result) => result.status >= 200 && result.status < 500,
    "booking request accepted": (result) => result.status === 201
  });
}

export function teardown(data) {
  const deadline = Date.now() + Number(__ENV.SETTLE_TIMEOUT_MS || 60_000);
  let bookings = [];

  while (Date.now() < deadline) {
    bookings = [];
    for (let page = 1; ; page += 1) {
      const response = http.get(
        `${baseUrls.bookings}/bookings/users/${data.userId}/bookings?page=${page}&pageSize=100`,
        { tags: { operation: "verify_bookings" } }
      );
      if (response.status !== 200) {
        bookings = [];
        break;
      }
      const batch = response.json();
      bookings.push(...batch);
      if (batch.length < 100) break;
    }
    if (bookings.length > 0 && bookings.every((booking) => ["CONFIRMED", "FAILED"].includes(booking.status))) {
      break;
    }
    sleep(0.5);
  }

  const eventResponse = http.get(`${baseUrls.events}/events/${data.eventId}`, {
    tags: { operation: "verify_inventory" }
  });
  const event = eventResponse.status === 200 ? eventResponse.json() : null;
  const confirmedQuantity = bookings
    .filter((booking) => booking.status === "CONFIRMED")
    .reduce((sum, booking) => sum + booking.quantity, 0);
  const allTerminal =
    bookings.length > 0 && bookings.every((booking) => ["CONFIRMED", "FAILED"].includes(booking.status));

  const invariantHolds = check(eventResponse, {
    "all bookings reached a terminal state": () => allTerminal,
    "available seats never exceed total seats": () => event && event.availableSeats <= event.totalSeats,
    "available seats never go below zero": () => event && event.availableSeats >= 0,
    "confirmed quantity plus available seats equals capacity": () =>
      event && confirmedQuantity + event.availableSeats === event.totalSeats
  });

  if (!invariantHolds) {
    fail(
      `Inventory invariant failed: confirmed=${confirmedQuantity}, available=${event?.availableSeats}, total=${event?.totalSeats}, bookings=${bookings.length}`
    );
  }
}
