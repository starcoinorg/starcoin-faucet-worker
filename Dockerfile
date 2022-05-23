FROM node:16

RUN apt-get update && apt-get -y install cron vim

COPY . /app

WORKDIR /app

RUN npm install

COPY docker/cron/cron.sh /usr/bin/cron.sh
RUN chmod +x /usr/bin/cron.sh

COPY docker/cron/crontab /etc/cron.d/crontab
RUN chmod 0644 /etc/cron.d/crontab

RUN touch /app/cron.log

ENTRYPOINT ["/bin/sh", "/usr/bin/cron.sh"]