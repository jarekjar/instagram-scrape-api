var express = require("express");
var router = express.Router();
var fetch = require("node-fetch");
var fs = require("fs");

let fetching = false;
let complete = false;
let queryHash = "5aefa9893005572d237da5068082d8d5";

//globals
const followerData = {
  count: 0,
  data: [],
};

const followingData = {
  count: 0,
  data: [],
};

/* GET main scrape. */
router.get("/", async (req, res, next) => {
  try {
    const { sessionId, profile } = req.query;

    if (!sessionId || !profile) {
      res
        .status(400)
        .send(
          `Missing required field(s): ${!sessionId ? "Session ID " : ""} ${
            !profile ? "Profile " : ""
          }`
        );
    }

    try {
      let parsedData = JSON.parse(fs.readFileSync(`output/${profile}.json`, "utf8"));
      res.status(200).send({
        status:
          "User already scraped, call again with ?force=true to scrape again",
        location: "access the data with /notfollowingme",
      });
    } catch (err) {
      console.log(err);
    }

    //do not start another job if one is running
    if (!complete && !fetching) {
      fetching = true;
    } else if (fetching) {
      res.status(400).send("JOB IN PROGRESS");
    } else {
      res
        .status(200)
        .send({ following: followingData.data, followers: followerData.data });
    }

    const id = await fetch(`https://www.instagram.com/${profile}/?__a=1`).then(
      (res) => res.json().then((response) => response.graphql.user.id)
    );

    //api request query variables
    const variables = {
      id: id,
      include_reel: true,
      fetch_mutual: false,
      first: 47,
      after: undefined,
    };

    //instagram graphql query string
    const callInstagramFetch = () =>
      fetch(
        `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(
          JSON.stringify(variables)
        )}`,
        {
          headers: {
            cookie: `sessionid=${sessionId}`,
            "x-requested-with": "XMLHttpRequest",
          },
          method: "GET",
          mode: "cors",
        }
      );

    const recursiveCall = async (isFollowers) => {
      try {
        return await callInstagramFetch().then((result) =>
          result.json().then(async (response) => {
            //scrape the follwers graphQL api
            if (isFollowers) {
              const { count, page_info, edges } =
                response.data.user.edge_followed_by;
              if (followerData.count !== count) {
                followerData.count = count;
              }
              followerData.data = [...followerData.data, ...edges];
              console.log("Collected so far...  ", followerData.data.length);
              await new Promise((resolve) => setTimeout(resolve, 400));
              if (page_info.has_next_page) {
                variables.after = page_info.end_cursor;
                recursiveCall(true);
              } else {
                //change to following
                queryHash = "3dec7e2c57367ef3da3d987d89f9dbc8";
                variables.after = undefined;
                recursiveCall(false);
              }

              //scrape the following graphQL api
            } else {
              const { count, page_info, edges } =
                response.data.user.edge_follow;
              if (followingData.count !== count) {
                followingData.count = count;
              }
              followingData.data = [...followingData.data, ...edges];
              await new Promise((resolve) => setTimeout(resolve, 400));
              console.log("Collected so far...  ", followingData.data.length);
              if (response.data.user.edge_follow.page_info.has_next_page) {
                variables.after = page_info.end_cursor;
                recursiveCall(false);
              } else {
                fetching = false;
                complete = true;
                fs.writeFile(
                  `output/${profile}.json`,
                  JSON.stringify({
                    following: followingData.data,
                    followers: followerData.data,
                    timestamp: new Date().getTime(),
                  }, null, 2),
                  function (err) {
                    if (err) {
                      console.log(err);
                    }
                  }
                );
                return;
              }
            }
          })
        );
      } catch (err) {
        console.log(err);
        res.status(500).send("API call failed.");
      }
    };

    res.status(202).send({
      status: "ACCEPTED. JOB IS STARTING.",
      location: "/status for status updates",
    });
    await recursiveCall(true);
  } catch (err) {
    console.log(err);
    res.status(500).send("API Failed");
  }
});

/* GET status. */
router.get("/status", function (req, res, next) {
  if (complete) {
    res.status(200).send({ status: "Complete" });
  } else if (fetching) {
    res.status(200).send({
      status: "In Progress",
      followingCount: `${followingData.data.length} out of ${followingData.count}`,
      followerCount: `${followerData.data.length} out of ${followerData.count}`,
    });
  } else {
    res.status(200).send({ status: "No job is running." });
  }
});

/* GET only the users not following me (check for a complete status first)*/
router.get("/notfollowingme", function (req, res, next) {
  const { profile } = req.query;
  if (!profile) {
    res.status(400).send(`Missing required field(s): Profile`);
  } else {
    try {
      parsedData = JSON.parse(fs.readFileSync(`output/${profile}.json`, "utf8"));
      let { followers, following } = parsedData;
      following = normalizeData(following);
      followers = normalizeData(followers);
      const data = following.filter(
        (user) => !followers.some((otherUser) => user.id === otherUser.id)
      );
      console.log("items: ", data.length);
      res.status(200).send(data);
    } catch (err) {
      console.log(err);
      res.status(400).send({ status: "no job completed" });
    }
  }
});

const normalizeData = (data) => {
  let newArray = [];
  data.forEach((item) => {
    delete item.node.profile_pic_url;
    delete item.node.reel;
    delete item.node.followed_by_viewer;
    delete item.node.follows_viewer;
    delete item.node.requested_by_viewer;
    newArray.push(item.node);
  });
  return newArray;
};

module.exports = router;
