# Winix fixtures

Answers of the Winix cloud, as published by the projects that reverse-engineered
it (see the README credits). Device ids, MAC addresses and aliases are invented.

- `status-c545.json`: state of a C545 (`/common/event/sttus/devices/…`), the
  sample quoted in `driver.py` of iprak/winix (MIT): no PM2.5 sensor.
- `status-pm25.json`: the state used by the iprak/winix tests (`conftest.py`),
  with a PM2.5 reading (`S04`).
- `status-no-data.json`: the answer for a purifier the cloud has no news of
  (iprak/winix issue #98).
- `device-info-list.json`: decrypted `getDeviceInfoList` answer, with the
  fields listed by winix-api (`WinixDevice`): two purifiers and a
  dehumidifier, which the integration ignores.
- `model-group-info.json`: decrypted `getAllModelGroupInfoList` answer, in the
  shape the iprak/winix tests use.
