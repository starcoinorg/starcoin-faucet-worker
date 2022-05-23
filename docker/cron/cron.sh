#!/usr/bin/env bash

printenv | cat - /etc/cron.d/crontab > ~/crontab.tmp \
    && mv ~/crontab.tmp /etc/cron.d/crontab

chmod 644 /etc/cron.d/crontab

tail -f /app/cron.log &

cron -f
