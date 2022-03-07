

/* eslint-disable no-undef */
Moralis.Cloud.job("processGroups", async (request) => {
    const { params, headers, log, message } = request;
    message("Starting Groups Processing");
    logger.info("Starting Groups Processing")
    await processGroups(request)
})

async function processGroups(request) {
    const { params, headers, log, message } = request;
    const query = new Moralis.Query("Group");
    const groups = await query.find({useMasterKey: true});
    for (let i=0; i< groups.length; i++) {
        const group = groups[i];
        logger.info(`[processGroups] ${i} ${group.id}`);
        const res = await sendGroup(group);
        if (res && res.status) {
            const success = await cleanupGroupAlertQueues(group, res);
            if (success) {
                group.set("lastSent",new Date());
                group.save(null, {useMasterKey: true});
            }
        }
    }
}


async function getGroupSendgridKey(group) {
    return await getAPIKey("SENDGRID_API_KEY");
}

function getGroupTemplateID(group) {
    const id = "d-6f11618fbe1d45a0a91e74e2a95646eb";
    return id;
}

async function cleanupGroupAlertQueues(group, result) {
    const aqs = await getGroupAlertQueues(group)
    logger.info("[cleanupGAQ] Cleanup " + aqs.length)
    try {
        const rel = group.relation("UserChannels");
        const channels = await rel.query().find({useMasterKey: true});
        const uChannel = channels[0];
        for (let i=0; i < aqs.length; i++) {
            const aq = aqs[i];
            const sub = aq.get("Subscription");
            await sub.fetch({useMasterKey: true});
            const content = aq.get("content");
            const clean = await saveAlertHistory(sub, content, result, uChannel, group, aq.id);
            if (clean) {
                await aq.destroy({useMasterKey: true});
            }
        }
    }
    catch (err) {
        logger.error(err)
        return false
    }
    return true;
}

async function getGroupAlertQueues(group) {
    const query = new Moralis.Query("AlertQueue");
    query.equalTo("Group", group);
    query.include("Subscription");
    return await query.find({useMasterKey: true});
}

async function getGroupTemplateData(group) {
    logger.info(`[groupTemplateData] Start`);
    const alerts = [];
    const aqs = await getGroupAlertQueues(group)
    logger.info(`[groupTemplateData] Got AQs ${aqs.length}`);
    for (let i=0; i < aqs.length; i++) {
        const alert = aqs[i];
        const content = alert.get("content");
        const messageData = alert.get("messageData") || {};
        const link = messageData.url || `https://www.cryptonotifi.xyz/alert/${alert.id}`;
        alerts.push({
            title: messageData.title,
            image: messageData.imageUrl,
            text: content.rich || content.plain,
            "c2a_link": link,
            "c2a_button": "Open"
        })
    }
    const data = {
        "groupName" : group.get("name"),
        "alerts": alerts
    }
 
    logger.info(`[groupTemplateData] return`);
    return data;
}

async function getGroupToData(group) {
    logger.info(`[groupToData] Start`);
    const to = [];
    const rel = group.relation("UserChannels");
    const channels = await rel.query().find({useMasterKey: true});
    channels.map( (c) => {
        to.push( { email: c.get("providerData").email })
    })
    if (channels.length == 0 ) {
        logger.error("GROUP Email TO HACK");
        to.push( { email: "brad@sileo.name" });
    }
    logger.info(`[groupToData] Return`);
    return to;
}

// Process and send messages for the passed in Group
async function sendGroup(group) {
    logger.info(`[sendGroup] Start ${group.id}`);
    const SENDGRID_API_KEY = await getGroupSendgridKey();
    const templateData = await getGroupTemplateData(group);
    const to = await getGroupToData(group);
    const data = {
      personalizations: [
        {
          to: to,
          dynamic_template_data: templateData,
        },
      ],
      from: { email: "no-reply@cryptonotifi.xyz", name: "Crypto Notifi" },
      subject: "CryptoNotifi Alert",
      template_id: getGroupTemplateID()
    };

    try {
      const httpResp = await Moralis.Cloud.httpRequest({
        method: "POST",
        url: "https://api.sendgrid.com/v3/mail/send",
        body: data,
        headers: {
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json;charset=utf-8",
        },
      });
      const result = { status: true, result: httpResp.text };
      logger.info("[sendGroup] Finished Group Send")
      return result;
    } catch (httpResp) {
      logger.error("Caught failed Group Email");
      const msg =
        "[SendEmailAlert] Request failed with response code " +
        httpResp.status +
        "::" +
        httpResp.text;
      logger.error(msg);
      const result = { status: false, error: msg, result: httpResp.text };
      return result;
    }
}