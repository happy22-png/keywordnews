const s=require('../lib/session');
const google=require('../lib/google-news');
module.exports=async function(req,res){
  if(req.method!=='POST')return s.send(res,405,{error:'POST 요청만 지원합니다.'});
  if(!s.sameOrigin(req))return s.send(res,403,{error:'같은 사이트에서만 조회할 수 있습니다.'});
  let input;try{input=s.body(req);}catch{return s.send(res,400,{error:'잘못된 조회 요청입니다.'});}
  const count=Number(input.count??20);
  if(typeof input.keyword!=='string'||!input.keyword.trim()||input.keyword.length>80||![1,3,7,30].includes(input.days)||![20,50,100].includes(count))return s.send(res,400,{error:'키워드, 조회 기간과 기사 수를 확인해주세요.'});
  try{const result=await google.fetchGoogleNews(input.keyword.trim(),input.days,count);return s.send(res,200,{...result,provider:'google-news-rss',switched:false,sources:[],searchEntry:'',tokens:0,attempts:['google-news-rss']});}
  catch(error){const status=error instanceof google.FeedError?error.status:502;return s.send(res,status,{error:error instanceof google.FeedError?error.message:'Google News RSS 처리에 실패했습니다.',attempts:['google-news-rss'],provider:'google-news-rss'});}
};
