/* eslint-disable no-undef */
Moralis.Cloud.afterSave("Alert", async (request) => {
  const alert = request.object;
  const query = new Moralis.Query("Subscription");
  const subType = alert.get("Type");
  await subType.fetch({ useMasterKey: true });
  const content = {
    plain: alert.get("content"),
    rich: alert.get("richContent"),
  };
  const prot = alert.get("protocol");
  let protocolName = ""
  let imageUrl = ""
  if (prot) {
    query.equalTo("Protocol", prot);
    await prot.fetch({useMasterKey: true});
    protocolName = prot.get("name");
    imageUrl = prot.get("iconURL");
  }
  const alertImageUrl = alert.get("imageUrl")
  if (alertImageUrl) {
    imageUrl = alertImageUrl;
  }
  query.equalTo("subscriptionType", "Protocol Alerts");
  query.equalTo("GeneralSubType", subType);
  const res = await query.find({ useMasterKey: true });
  for (let i = 0; i < res.length; i++) {
    const sub = res[i];
    logger.info(`[alert.afterSave()] Sending "${content.plain}" to SubID=${sub.id}`);
    const messageData = {
      title: `${protocolName} Protocol Update`,
      subscriptionType: "Protocol Alert",
      imageUrl: imageUrl,
      protocolName: protocolName,
      category: subType.get("name"),
      url: alert.get("url"),
    }
    sendAlert(sub, content, messageData);
  }
});
