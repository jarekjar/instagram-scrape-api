var express = require("express");
var router = express.Router();
const fetch = require("node-fetch");

/* GET main scrape. */
router.get("/", async (req, res, next) => {
  try {
    const { sessionId, profile } = req.query;

    let queryHash = "5aefa9893005572d237da5068082d8d5";

    //globals
    let followerData = {
      count: 0,
      data: [],
    };

    let followingData = {
      count: 0,
      data: [],
    };

    const variables = {
      id: "7057601400",
      include_reel: true,
      fetch_mutual: false,
      first: 47,
      after: undefined,
    };

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
                res.status(200).send({
                  followers: followerData.data,
                  following: followingData.data,
                });
              }
            }
          })
        );
      } catch (err) {
        console.log(err);
        res.status(500).send("API call failed.");
      }
    };

    await recursiveCall(true);
  } catch (err) {
    console.log(err);
    res.status(500).send("API Failed");
  }
});

module.exports = router;