
Moralis.Cloud.beforeSave("Group", async (request) => {
    const group = request.object;
    //logger.info(`[group.beforeSave] ${group.id}`);
    try {
        updateNextSend(group);
    }
    catch (err) {
        logger.error("beforeSave - " + err)
    }
});

Moralis.Cloud.afterDelete("Group", async (request) => {
    try {
    const query = new Moralis.Query("Subscription");
    query.equalTo("Group", request.object);
    const subs = await query.find({useMasterKey: true})
    subs.forEach( async (aSub) => {
        aSub.unset("Group");
        await aSub.save(null, {useMasterKey: true});
    })
    } catch (err) {
        logger.error("Group.afterDelete - " + err)
    }
  });

// date: Date, day: days[] :(0 = Sunday...6 = Saturday)
// Returns a Date
function nextDay(date, day) {
    const result = new Date(date.getTime());
    const offset = ((day + 6 - date.getDay()) % 7) + 1;
    result.setDate(date.getDate() + offset);
    return result;
};

const days = {
    "Sunday": 0,
    "Monday": 1,
    "Tuesday": 2,
    "Wednesday": 3,
    "Thursday": 4,
    "Friday": 5,
    "Saturday": 6,
}

function updateNextSend(group) {
    if (group.get("frequency") == "Real-time") return;
    if (group.get("frequency") == "") return;
    let d = new Date();
    const db = group.get("alertTime");
    const ds = `Jan 1, 1900 ${db}`;
    const alertTime = new Date(ds);
    const h = alertTime.getHours();
    const m = alertTime.getMinutes();
    // logger.info(`ds="${ds}" at=${alertTime} h=${h} - m=${m}`);
    d.setHours(h);
    d.setMinutes(m, 0, 0);
    // logger.info(d)
    if (group.get("frequency") == "Weekly") {
      const dayINeed = days[group.get("alertDay")];
      //logger.info (dayINeed)
      d = nextDay(d, dayINeed);
      //logger.info(d);
    } else if (group.get("frequency") == "Daily") {
      d.setDate(d.getDate() + 1);
    }
    logger.info(`${group.id}.nextSend set to ${d}`);
    group.set("nextSend", d);
  }

/* eslint-disable no-undef */
Moralis.Cloud.job("processGroups", async (request) => {
    const { params, headers, log, message } = request;
    message("Starting Groups Processing");
    logger.info("Starting Groups Processing")
    await processGroups(request)
})

async function getGroupsToProcess() {
    let groups = [];
    groups.push(... await getDailyGroupsToProcess())
    groups.push(... await getWeeklyGroupsToProcess())
    logger.info(`[groupsToProcess] ${groups.length}`)
    return groups
}

async function getDailyGroupsToProcess() {
    let dt = new Date();
    const query = new Moralis.Query("Group");
    query.equalTo("frequency", "Daily");
    query.lessThan("nextSend", dt)
    const groups = await query.find({useMasterKey: true});
    return groups;
}

async function getWeeklyGroupsToProcess() {
    let dt = new Date();
    const query = new Moralis.Query("Group");
    query.equalTo("frequency", "Weekly");
    query.lessThan("nextSent", dt)
    const groups = await query.find({useMasterKey: true});
    return groups;
}


async function processGroups(request) {
    const { params, headers, log, message } = request;
    const groups = await getGroupsToProcess();
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
        const uChannel = group.get("UserChannel");
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
    try {
        const channel = group.get("UserChannel");
        await channel.fetch({useMasterKey: true});
        to.push( { email: channel.get("providerData").email })
    } catch (err) {
        logger.error("[groupToData] Failed - " + err)
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