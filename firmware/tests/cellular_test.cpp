#include "../kerumo_v3/src/cellular.h"
#include <cassert>
#include <cstdio>
#include <limits>

using namespace kerumo;
class Port : public CellularPort {
public:
  bool ready = true, attached = false, dial = true, ip = false;
  int starts = 0, polls = 0, ends = 0, dials = 0;
  bool begin(const char *) override { ++starts; return ready; }
  bool registered() override { ++polls; return attached; }
  bool enterData() override { ++dials; return dial; }
  bool online() const override { return ip; }
  void end() override { ++ends; ip = false; }
};
int main() {
  int16_t dbm = 42;
  assert(csqDbm(17, dbm) && dbm == -79);
  assert(csqDbm(0, dbm) && dbm == -113);
  assert(csqDbm(31, dbm) && dbm == -51);
  assert(!csqDbm(99, dbm) && dbm == -51);
  assert(!csqDbm(-1, dbm) && !csqDbm(32, dbm));
  Port port;
  CellularLink link(port, "internet");
  assert(!link.tick(0) && port.starts == 1);
  assert(!link.tick(1) && port.polls == 1);
  assert(!link.tick(1000) && port.polls == 1);
  port.attached = true;
  assert(!link.tick(2001) && port.dials == 1);
  assert(!link.tick(3000)); // AT attach is not an IP connection.
  port.ip = true;
  assert(link.tick(4000));
  port.ip = false;
  assert(!link.tick(5000) && port.ends == 1);
  assert(!link.tick(14999) && port.starts == 1);
  assert(!link.tick(15000) && port.starts == 2);
  port.dial = false;
  assert(!link.tick(15001) && port.ends == 2);
  port.ready = false;
  assert(!link.tick(25001) && port.starts == 3 && port.ends == 3);
  Port waiting;
  CellularLink registration(waiting, "internet");
  const uint32_t start = std::numeric_limits<uint32_t>::max() - 1000;
  registration.tick(start);
  registration.tick(start + 119999u);
  assert(waiting.ends == 0);
  registration.tick(start + 120000u);
  assert(waiting.ends == 1); // Deadline survives millis wraparound.
  Port address;
  address.attached = true;
  CellularLink noIp(address, "internet");
  noIp.tick(0); noIp.tick(1); noIp.tick(60000);
  assert(address.ends == 0);
  noIp.tick(60001);
  assert(address.ends == 1);
  std::puts("PASS: cellular registration/IP distinction, disconnect, retry, bounded deadlines and CSQ");
}
