// <member-feed>: members' posts with likes and comments.
// Call start({ user, isAdmin }) once the member is logged in. Authors can
// edit and delete their posts; admins can delete anyone's posts and comments.
import {
  supabase,
  setStatus,
  withForm,
  loadMemberNames,
  formatWhen,
  renderByline,
  el,
} from "../shared.js?v=2";

const PAGE_SIZE = 50;

class MemberFeed extends HTMLElement {
  #member = null;
  #openComments = new Set();

  connectedCallback() {
    if (this.hasChildNodes()) return;
    this.innerHTML = `
      <form class="member-form post-composer">
        <label class="field">
          <span>New post</span>
          <textarea name="body" rows="3" maxlength="5000" required
            placeholder="Share something with the studio…"></textarea>
        </label>
        <button class="button" type="submit">Post</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
      <p class="field-note feed-empty" hidden>No posts yet. Say hello!</p>
      <ul class="feed"></ul>`;

    const composer = this.querySelector(".post-composer");
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = composer.body.value.trim();
      if (!body) return;
      withForm(composer, "Posting…", async () => {
        const { error } = await supabase.from("posts").insert({ body });
        if (error) {
          console.error(error);
          setStatus(composer, "Couldn't post. Please try again.", true);
          return;
        }
        composer.reset();
        setStatus(composer, "");
        await this.load();
      });
    });
  }

  start(member) {
    this.#member = member;
    this.load();
  }

  async load() {
    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, author_id, body, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      console.error(error);
      this.#showEmpty("Couldn't load posts. Please refresh.");
      return;
    }

    const postIds = posts.map((post) => post.id);
    const [comments, likes] = postIds.length
      ? await Promise.all([
          supabase
            .from("comments")
            .select("id, post_id, author_id, body, created_at")
            .in("post_id", postIds)
            .order("created_at"),
          supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
        ]).then((results) => results.map(({ data }) => data ?? []))
      : [[], []];

    const names = await loadMemberNames([
      ...posts.map((post) => post.author_id),
      ...comments.map((comment) => comment.author_id),
    ]);

    this.#showEmpty(posts.length ? null : "No posts yet. Say hello!");
    this.querySelector(".feed").replaceChildren(
      ...posts.map((post) =>
        this.#renderPost(
          post,
          comments.filter((comment) => comment.post_id === post.id),
          likes.filter((like) => like.post_id === post.id),
          names,
        ),
      ),
    );
  }

  #showEmpty(message) {
    const empty = this.querySelector(".feed-empty");
    empty.hidden = !message;
    if (message) empty.textContent = message;
  }

  #canDelete(authorId) {
    return authorId === this.#member.user.id || this.#member.isAdmin;
  }

  #renderPost(post, comments, likes, names) {
    const item = el("li", "post");
    const isMine = post.author_id === this.#member.user.id;

    const header = el("div", "post-header");
    const when = el("time", "post-time", formatWhen(post.created_at));
    when.dateTime = post.created_at;
    header.append(renderByline(names.get(post.author_id)), when);
    if (post.updated_at) header.append(el("span", "post-time", "(edited)"));

    const body = el("p", "post-body", post.body);

    const actions = el("div", "post-actions");
    const liked = likes.some((like) => like.user_id === this.#member.user.id);
    const like = el(
      "button",
      `link-button like-button${liked ? " is-liked" : ""}`,
      `${liked ? "♥" : "♡"} ${likes.length || ""}`.trim(),
    );
    like.type = "button";
    like.setAttribute("aria-pressed", liked);
    like.setAttribute("aria-label", `${liked ? "Unlike" : "Like"} (${likes.length} likes)`);
    like.addEventListener("click", () => this.#toggleLike(post.id, liked));

    const toggle = el(
      "button",
      "link-button",
      comments.length ? `Comments (${comments.length})` : "Comment",
    );
    toggle.type = "button";
    actions.append(like, toggle);

    if (isMine) {
      const edit = el("button", "link-button", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => this.#editPost(item, body, post));
      actions.append(edit);
    }
    if (this.#canDelete(post.author_id)) {
      const remove = el("button", "link-button", "Delete");
      remove.type = "button";
      remove.addEventListener("click", () =>
        this.#delete("posts", post.id, "Delete this post?"),
      );
      actions.append(remove);
    }

    const thread = this.#renderComments(post, comments, names);
    thread.hidden = !this.#openComments.has(post.id);
    toggle.setAttribute("aria-expanded", !thread.hidden);
    toggle.addEventListener("click", () => {
      thread.hidden = !thread.hidden;
      toggle.setAttribute("aria-expanded", !thread.hidden);
      if (thread.hidden) this.#openComments.delete(post.id);
      else {
        this.#openComments.add(post.id);
        thread.querySelector("input").focus();
      }
    });

    item.append(header, body, actions, thread);
    return item;
  }

  #renderComments(post, comments, names) {
    const thread = el("div", "post-comments");
    const list = el("ul", "comment-list");

    comments.forEach((comment) => {
      const item = el("li", "comment");
      const header = el("div", "post-header");
      const when = el("time", "post-time", formatWhen(comment.created_at));
      when.dateTime = comment.created_at;
      header.append(renderByline(names.get(comment.author_id)), when);
      if (this.#canDelete(comment.author_id)) {
        const remove = el("button", "link-button", "Delete");
        remove.type = "button";
        remove.addEventListener("click", () =>
          this.#delete("comments", comment.id, "Delete this comment?"),
        );
        header.append(remove);
      }
      item.append(header, el("p", "post-body", comment.body));
      list.append(item);
    });

    const form = el("form", "comment-form");
    form.innerHTML = `
      <input type="text" name="body" maxlength="2000" required
        placeholder="Write a comment…" aria-label="Write a comment" />
      <button class="button button-quiet" type="submit">Reply</button>
      <p class="form-status" role="status" aria-live="polite"></p>`;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = form.body.value.trim();
      if (!body) return;
      withForm(form, "", async () => {
        const { error } = await supabase
          .from("comments")
          .insert({ post_id: post.id, body });
        if (error) {
          console.error(error);
          setStatus(form, "Couldn't comment. Please try again.", true);
          return;
        }
        await this.load();
      });
    });

    thread.append(list, form);
    return thread;
  }

  #editPost(item, body, post) {
    const form = el("form", "member-form post-edit");
    form.innerHTML = `
      <textarea name="body" rows="4" maxlength="5000" required aria-label="Edit post"></textarea>
      <div class="piece-actions">
        <button class="button" type="submit">Save</button>
        <button class="button button-quiet" type="button">Cancel</button>
      </div>
      <p class="form-status" role="status" aria-live="polite"></p>`;
    form.body.value = post.body;
    form.querySelector("button[type=button]").addEventListener("click", () => this.load());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      withForm(form, "Saving…", async () => {
        const { error } = await supabase
          .from("posts")
          .update({ body: form.body.value.trim() })
          .eq("id", post.id);
        if (error) {
          console.error(error);
          setStatus(form, "Couldn't save. Please try again.", true);
          return;
        }
        await this.load();
      });
    });
    body.replaceWith(form);
    form.body.focus();
  }

  async #toggleLike(postId, liked) {
    const { error } = liked
      ? await supabase
          .from("post_likes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", this.#member.user.id)
      : await supabase.from("post_likes").insert({ post_id: postId });
    if (error) console.error(error);
    await this.load();
  }

  async #delete(table, id, question) {
    if (!window.confirm(question)) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) {
      console.error(error);
      window.alert("Couldn't delete that. Please try again.");
      return;
    }
    await this.load();
  }
}

customElements.define("member-feed", MemberFeed);
