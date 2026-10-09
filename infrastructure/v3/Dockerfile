FROM eclipse-mosquitto:2
USER root
RUN apk add --no-cache python3 py3-cryptography
COPY generate.py /opt/kerumo/generate.py
COPY controllers.py /opt/kerumo/controllers.py
COPY v4.py /opt/kerumo/v4.py
