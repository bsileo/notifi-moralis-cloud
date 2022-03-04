/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-unused-vars */
async function sendEmailAlert(channel, content, subscription, messageData) {
  const logger = Moralis.Cloud.getLogger();
  logger.info(`Email send ${content} to ${channel.get("providerData").email}`);
  const SENDGRID_API_KEY = await getAPIKey("SENDGRID_API_KEY");
  const data = {
    personalizations: [
      {
        to: [{ email: channel.get("providerData").email }],
      },
    ],
    from: { email: "no-reply@cryptonotifi.xyz", name: "Crypto Notifi" },
    subject: "CryptoNotifi Alert",
  };
  
  let categoryTemplateID = null;
  let protTemplateID = null;
  const subType = subscription.get("GeneralSubType");
  if (subType) {
    if (!subType.isDataAvailable()) {
      await subType.fetch();
    }
    categoryTemplateID = subType.get("SendgridTemplateID");
  }
  const prot = subscription.get("Protocol");
  if (prot) {
    if (!prot.isDataAvailable()) {
      await prot.fetch();
    }
    protTemplateID = prot.get("SendgridTemplateID");
  }

  //logger.info(`PROT-${protTemplateID} SUB-${categoryTemplateID}`)
  if (categoryTemplateID) {
    logger.info(`[SendEmailAlert] Use Category Template`);
    messageData.content = content.rich || content.plain
    data.personalizations[0].dynamic_template_data = messageData;
    data.template_id = categoryTemplateID;
  } else if (protTemplateID) {
    logger.info(`[SendEmailAlert] Use Protocol Template`);
    if (content.rich) messageData.content = content.rich;
    else messageData.content = content.plain;
    data.personalizations[0].dynamic_template_data = messageData;
    data.template_id = protTemplateID;
    data.subject = `${prot.get("Name")} Alert`;
  } else {
    logger.info(`[SendEmailAlert] Send raw content email`);
    const sendgridContent = [{ type: "text/plain", value: content.plain }];
    if (content.rich) {
      sendgridContent.push({ type: "text/html", value: content.rich });
    }
    data.content = sendgridContent;
  }
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
    return result;
  } catch (httpResp) {
    logger.error("Caught failed Email");
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
