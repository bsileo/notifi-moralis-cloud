/* eslint-disable @typescript-eslint/no-unused-vars */

/* eslint-disable no-undef */
Moralis.Cloud.job("processPositions", async (request) => {
    const { params, headers, log, message } = request;
    message("Starting Positions Processing");
    processPositionSubscriptions(request)
})

async function processPositionSubscriptions(request) {
    const { params, headers, log, message } = request;
    const subQuery = new Moralis.Query("Subscription");
    subQuery.equalTo("subscriptionType", "Position");
    subQuery.equalTo("status", "active");
    subQuery.ascending("contractChain");
    const subs = await subQuery.find({ useMasterKey: true });
    //logger.info("[processPositionSubscriptions] Got Subs");
    message(`Processing ${subs.length} Position Subscriptions - Gather Records`)
    const records = {};
    for (let i = 0; i < subs.length; i++) {
      try {
        const chain = subs[i].get("contractChain");
        const prot = subs[i].get("Protocol")
        if (prot == undefined) {
          logger.error("[processPositionSubscriptions] Missing Protocol for " + subs[i].id); 
          continue;
        }
        await prot.fetch({useMasterKey: true});
        const project = prot.get("cookieName");
        const user =  subs[i].get("User")
        await user.fetch({useMasterKey: true});
        const acct = user.get("accounts")[0];
        if (chain && project && acct) {
            if (!records[chain]) records[chain] = {};
            if (!records[chain][project]) records[chain][project] = {};
            if (!records[chain][project][acct]) records[chain][project][acct] = {};
            if (!records[chain][project][acct].subscriptions) records[chain][project][acct].subscriptions = [];
            records[chain][project][acct].subscriptions.push(subs[i]);
        } else {
            logger.error("[processPositionSubscriptions]Missing Chain/Project/Acct for " + subs[i].id);
        }
      }
      catch (err) {
        logger.error(`[processPositionSubscriptions] Failed processing Subscription ID ${subs[i].id} - ${err.message}`);
      }
    }
    message(`Gathering Project Positions`)
    logger.info("[processPositionSubscriptions] Gathering Project Positions");
    for (const chain in records) {
        const projects = records[chain];
        for (const project in projects) {
            const accounts = projects[project];
            for (account in accounts) {
                const positions = await getProjectPositions(chain, project, account, message );
                records[chain][project][account].positions = positions;
            }
        }
    };
    message(`Processing Subscriptions`)
    logger.info("[processPositionSubscriptions] Processing Subscriptions");
    for (const chain in records) {
        const projects = records[chain];
        for (const project in projects) {
            const accounts = projects[project];
            for (account in accounts) {
                const curSubs = records[chain][project][account].subscriptions;
                curSubs.forEach( (sub) => {
                    //logger.info(
                    //    `[processPositionSubscriptions] Start Position sub ${sub.id} #################################`
                    //  );
                    messageData = {
                        address: sub.get("contractAddress"),
                        protocolName: sub.get("Protocol")?.get("name"),
                        subscriptionName: sub.get("name"),
                      };

                    processPositionHit(sub, records[chain][project][account].positions, messageData, message);
                })
            }
        }
    }
    message(`Completed`)
  }

  // eslint-disable-next-line prettier/prettier
  async function processPositionHit(subscription, positionRecords, messageData, message ) {
    //logger.info(`[processPositionHit] Start ${subscription.id}"`);
    let hit = false;
    const msg = ""
    const pos = await getPosition(subscription, positionRecords, message);
    if (pos) {
        //logger.info(`[processPositionHit] Got POS Back - ${pos}`);
        hit = await checkPosition(subscription, pos, messageData, message);
    } else {
        logger.error(`[processPositionHit] No Position found for ${subscription.id}`);
    }
    if (hit) {
      const msg = `Position Change Alert - ${messageData.reason}`
      const content = { plain: msg, rich: msg };
      const template = getPlainTemplate(subscription);
      const richTemplate = getRichTemplate(subscription);
      if (template) {
        const pTemplate = processTemplate(template, messageData);
        content.plain = `${pTemplate}`;
        content.rich = content.plain;
      }
      if (richTemplate) {
        const rTemplate = processTemplate(richTemplate, messageData);
        content.rich = `${rTemplate}`;
      }
      //logger.info(`[processPositionHit] Sending`);
      sendAlert(subscription, content, messageData);
    } else {
      //logger.info(`[processPositionHit] No Hit`);
    }
  }

  function getPlainTemplate(subscription) {
    const t = subscription.get("plainTemplate")
    if (t) return t;
    let msg = "Your position in {{ protocolName }} called {{ subscriptionName }} has changed.\n";
    msg = msg + "The current position value of ${{ positionValue }} {{ reason }} limit of ${{ reasonValue }}.";
    return msg;
  }

  function getRichTemplate(subscription) {
    const t = subscription.get("richTemplate")
    if (t) return t;
    return undefined;
  }

  async function getPosition(subscription, records, message) {
    const contract = subscription.get("contractAddress");
    const status = subscription.get("positionStatus");
    //logger.info("[getPosition] Processing Records "+ records.length)
    //logger.info(`[getPosition] SUB--${contract} -- ${status}`)
    let pos = null;
    for (let i=0; i< records.length; i++) {
        const rec = records[i];
        if (rec.address == contract && rec.status == status ) pos = rec;
    }
    //logger.info(`[getPosition] Match? ${pos}`);
    return pos;
  }

  async function getProjectPositions(chain, project, account, message) {
    //logger.info(`[getProjectPositions] Setup Started`)
    const config = await Moralis.Config.get({useMasterKey: true});
    const cookieAPI = config.get("cookieAPIURL")
    const url = `${cookieAPI}/${chain}/${project}?address=${account}`;
    logger.info(`[getProjectPositions] Requesting ${url}`)
    message(`Requesting ${url}`);
    const resp = await Moralis.Cloud.httpRequest({url: url })
    let records = null;
    if (resp.status = 200) {
        //const text = resp.text
        //logger.info("TEXT=" + text)
        const rawData = resp.data
        logger.info("[getProjectPositions] DATA Status=" + rawData.status)
        //const data = JSON.parse(resp.text);
        //logger.info("JDATA=" + data);
        records = rawData.data;
    } else {
        logger.error("[getProjectPositions] Failed to read =" + url)
        throw "Failed to read " + url;
    }
    return records;
  }

  async function checkPosition(subscription, pos, messageData, message) {
      logger.info("[checkPosition] Start");
      const subPosLow = subscription.get("positionLow")
      const subPosHigh = subscription.get("positionHigh")

      const posType = pos.type;
      let hit = false;
      let posValue = 0;
      logger.info(`[checkPosition] ${subPosLow} < ${posType} ???? > ${subPosHigh}`)
      if (subPosLow || subPosHigh) {
        if (posType == 'token') {
            posValue = pos.balance * pos.price
        } else if (posType = 'lpToken') {
            posValue = pos.token0.balance * pos.token0.price + pos.token1.balance + pos.token1.price
        }
        logger.info(`[checkPosition] ${subPosLow} < ${posValue} > ${subPosHigh}`);
        if (subPosHigh != undefined && posValue > subPosHigh) {
            messageData.reason = "Exceeded High";
            messageData.reasonValue = subPosHigh;
            hit = true;
        } else if (subPosLow != undefined && posValue < subPosLow) {
            messageData.reason = "Under Low";
            messageData.reasonValue = subPosLow;
            hit = true;
        }
        messageData.positionValue = roundToTwo(posValue);
        messageData.subPosHigh = subPosHigh;
        messageData.subPosLow = subPosLow;
      }
      logger.info("[checkPosition] Finish - " + hit);
      return hit;
  }